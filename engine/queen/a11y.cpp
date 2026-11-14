/* Ghostlight - accessibility layer for the ScummVM Queen engine (read side)
 *
 * Copyright (C) 2026 Ghostlight contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This file is NEW code added to a GPL ScummVM fork. It is copied into
 * engines/queen of the pinned ScummVM checkout by the build. Never edit the
 * checkout by hand.
 *
 * Line sources (stock ScummVM ad351d1e9d, engines/queen):
 *   A11Y          room state     Logic::currentRoom, Logic::objectData, Grid::objectBox
 *   A11Y_DIFF     one per action snapshot at queen.cpp JWM_EXECUTE, emitted at the next idle frame
 *   A11Y_TEXT     spoken line    Talk::speak (talk.cpp), floppy has no speech so never VTEXT
 *   A11Y_CHOICES  dialogue menu  Talk::selectSentence (talk.cpp)
 *   A11Y_INV      carried items  Logic::itemData
 *   A11Y_PHASE    control/busy/choice
 *   A11Y_CMD      echo of a command when it starts
 *   A11Y_ERR      a refused or dropped command
 *   A11Y_SAVED    after `save N`
 *
 * Command side: <savepath>/a11y-cmd.txt is read and truncated (same as
 * engine/a11y.cpp readCommandFile). Commands start only at the idle branch
 * (onIdle). Verbs are dispatched by pushing the same events a player makes
 * (verb action, then mouse move and left click), not by calling Command
 * internals: Command::_state and grabSelectedNoun are private (brief
 * section 2 gotcha 6) and the click path is what the probe proved.
 */

// getenv for the survey-only `room` command (same exception the probe used).
#define FORBIDDEN_SYMBOL_EXCEPTION_getenv

#include "common/array.h"
#include "common/config-manager.h"
#include "common/events.h"
#include "common/fs.h"
#include "common/path.h"
#include "common/str.h"
#include "common/stream.h"
#include "common/system.h"
#include "common/util.h"

#include "queen/a11y.h"
#include "queen/command.h"
#include "queen/defs.h"
#include "queen/display.h"
#include "queen/graphics.h"
#include "queen/grid.h"
#include "queen/input.h"
#include "queen/logic.h"
#include "queen/queen.h"
#include "queen/resource.h"
#include "queen/state.h"
#include "queen/structs.h"

namespace Queen {
namespace A11y {

// Queen has no chapters (brief section 1). A constant 1 keeps the sequential
// chapter filter in src/hints/select.ts harmless.
static const int kChapter = 1;

enum {
	kPhaseNone = 0,
	kPhaseControl,
	kPhaseBusy,
	kPhaseChoice
};

// Wall clock of the last line written, for the busy watchdog the command side
// will add (same role as g_lastEngineOutputMs in engine/a11y.cpp).
static uint32 g_lastOutputMs = 0;

uint32 lastOutputMs() {
	return g_lastOutputMs;
}

// All a11y output is one prefixed line on stderr, so a web page reads it via
// Module.printErr and a native run reads it on fd 2. logMessage with the error
// type goes to stderr on the SDL backend and adds no prefix of its own, which
// keeps every line clean and parseable (same path as engine/a11y.cpp emitLine).
static void emitLine(const Common::String &line) {
	if (!g_system)
		return;
	g_lastOutputMs = g_system->getMillis();
	Common::String out = line + "\n";
	g_system->logMessage(LogMessageType::kError, out.c_str());
}

// Escape a string for a JSON double-quoted value (same rules as the Drascula
// layer). Bytes 0x80 and up are passed through untouched: the English data is
// plain ASCII, other languages are not a goal for this task.
static Common::String jsonEscape(const char *s) {
	Common::String out;
	for (const char *p = s; p && *p; p++) {
		unsigned char c = (unsigned char)*p;
		switch (c) {
		case '"':  out += "\\\""; break;
		case '\\': out += "\\\\"; break;
		case '\n': out += "\\n";  break;
		case '\r': out += "\\r";  break;
		case '\t': out += "\\t";  break;
		default:
			if (c < 0x20)
				out += Common::String::format("\\u%04x", c);
			else
				out += (char)c;
		}
	}
	return out;
}

// Strip the in-text speech commands so a screen reader never sees them.
// Talk::getSpeakCommand (talk.cpp) reads '*' plus two characters (for
// example *FL, *WT or *05); *XY is the one long form, '*XY' plus 11 more
// characters like "00(237,112)" (the "index += 11" in its XY case). Newlines
// and tabs become spaces and runs of spaces collapse.
static Common::String cleanText(const char *s) {
	Common::String r;
	if (!s)
		return r;
	for (const char *p = s; *p; ++p) {
		if (*p == '*') {
			uint skip = (p[1] == 'X' && p[2] == 'Y') ? 13 : 2;
			while (skip > 0 && p[1] != '\0') {
				++p;
				--skip;
			}
			if (!r.empty() && r.lastChar() != ' ')
				r += ' ';
		} else if (*p == '\n' || *p == '\r' || *p == '\t' || *p == ' ') {
			if (!r.empty() && r.lastChar() != ' ')
				r += ' ';
		} else {
			r += *p;
		}
	}
	r.trim();
	return r;
}

// ---------------------------------------------------------------- lookups

// Total number of objects. roomData has numRooms + 2 entries, the last one
// closes the final room (the probe relied on the same fact).
static uint16 numObjects(Logic *l) {
	return l->roomData(l->numRooms() + 1);
}

// Name text for a name index. ObjectData::name is negative for a hidden object
// (structs.h, "<0: object is hidden"), the text index is its absolute value.
static Common::String nameText(Logic *l, int16 n) {
	int a = ABS((int)n);
	if (a < 1 || a > (int)l->numNames())
		return Common::String();
	return cleanText(l->objectName((uint16)a));
}

// Look text for an item. Some descriptions are cutaway or dialogue files
// (".CUT", ".DOG", command.cpp executeIfCutaway/executeIfDialog), not text.
static Common::String lookText(Logic *l, uint16 d) {
	if (d < 1 || d > l->numDescriptions())
		return Common::String();
	Common::String t = cleanText(l->objectTextualDescription(d));
	if (t.hasSuffixIgnoreCase(".CUT") || t.hasSuffixIgnoreCase(".DOG"))
		return Common::String();
	return t;
}

// An item is carried when its name is positive (brief section 1, inventory).
// The journal is the save/load screen, not a puzzle item, so it is left out:
// the player must never offer "use journal" (brief section 1, inventory gap).
static bool isCarried(Logic *l, uint16 id) {
	return id != ITEM_JOURNAL && l->itemData(id)->name > 0;
}

static const char *verbWord(Verb v) {
	switch (v) {
	case VERB_OPEN:    return "open";
	case VERB_CLOSE:   return "close";
	case VERB_MOVE:    return "push";
	case VERB_GIVE:    return "give";
	case VERB_USE:     return "use";
	case VERB_PICK_UP: return "take";
	case VERB_TALK_TO: return "talk";
	case VERB_LOOK_AT: return "look";
	default:           return "walk";
	}
}

// ---------------------------------------------------------------- state

struct ObjSnap {
	int16 name;
	int16 entryObj;
};

struct Snap {
	uint16 room;
	int16 heroX, heroY;
	int16 gs[Logic::GAME_STATE_COUNT];
	Common::Array<ObjSnap> objs;  // index = global object number
	Common::Array<int16> items;   // index = item id, value = ItemData::name

	Snap() : room(0), heroX(0), heroY(0) {
		for (int i = 0; i < Logic::GAME_STATE_COUNT; ++i)
			gs[i] = 0;
	}
};

struct SaidLine {
	Common::String color;
	Common::String text;
};

// A layer command in flight (verb on an object, walk, use, choose, room).
// Stages run one per idle frame so the verb key and the click never share a
// frame (the verb is read first by Command::updatePlayer, the click after).
enum {
	kStageScroll = 0,   // bring the item into one of the 4 visible slots
	kStageVerb,         // push the verb action
	kStageItem,         // push the inventory slot key
	kStageClick,        // push mouse move and left click on the object
	kStageWait          // click sent, waiting for JWM_EXECUTE (onBeforeAction)
};

struct Run {
	bool active;        // a command is in flight, its diff is not out yet
	bool started;       // the engine action began (diff armed)
	int stage;
	Common::String text;
	int verbAction;     // kAction* to push, or -1 for none (walk)
	uint16 item;        // item id for `use I N`, else 0
	uint16 noun;        // room-relative object number
	int wait;           // idle frames spent in kStageWait
	int scrolls;        // inventory scroll steps taken
	int scrollDir;      // +1 down, -1 up
	bool flipped;       // direction already reversed once
	uint32 lastSig;     // visible slots before the last scroll step

	Run() : active(false), started(false), stage(kStageVerb), verbAction(-1),
	        item(0), noun(0), wait(0), scrolls(0), scrollDir(1), flipped(false),
	        lastSig(0) {}
};

struct Layer {
	Snap before;                    // snapshot taken before the pending action
	bool pending;                   // a diff is armed and not yet emitted
	Common::String cmd;             // verb and object of the pending action
	Common::Array<SaidLine> said;   // lines spoken since the snapshot
	bool roomSeen;
	uint16 lastRoom;
	bool invSeen;
	Common::Array<byte> lastCarried;
	int phase;
	bool idleToken;                 // set by onIdle, consumed by the update(true) that follows

	Run run;                        // the layer command in flight
	Common::Array<Common::String> queue;  // lines read from the command file
	uint32 lastReadMs;              // last command-file read from onUpdate
	int choiceCount;                // visible options of the open menu
	Common::String choicesLine;     // last A11Y_CHOICES line, for `choices`
	uint32 chooseBlockedUntil;      // a pushed `choose` is not yet consumed

	Layer() : pending(false), roomSeen(false), lastRoom(0), invSeen(false),
	          phase(kPhaseNone), idleToken(false), lastReadMs(0), choiceCount(0),
	          chooseBlockedUntil(0) {}
};

// Lazily allocated, never freed: the process owns it until exit, and a plain
// static object would need a global constructor (not allowed in ScummVM).
static Layer *g_layerPtr = nullptr;

static Layer &layer() {
	if (!g_layerPtr)
		g_layerPtr = new Layer();
	return *g_layerPtr;
}

static void takeSnap(QueenEngine *vm, Snap &s) {
	Logic *l = vm->logic();
	s.room = l->currentRoom();
	// Hero point: Joe is bob 0 (probe: joe=150,130 equals the first object's
	// walk-to point, so it is a foot point). Unconfirmed beyond that.
	BobSlot *joe = vm->graphics()->bob(0);
	s.heroX = joe->x;
	s.heroY = joe->y;
	for (int i = 0; i < Logic::GAME_STATE_COUNT; ++i)
		s.gs[i] = l->gameState(i);
	uint16 n = numObjects(l);
	s.objs.resize(n + 1);
	s.objs[0].name = 0;
	s.objs[0].entryObj = 0;
	for (uint16 i = 1; i <= n; ++i) {
		ObjectData *od = l->objectData(i);
		s.objs[i].name = od->name;
		s.objs[i].entryObj = od->entryObj;
	}
	uint16 ni = l->itemDataCount();
	s.items.resize(ni + 1);
	s.items[0] = 0;
	for (uint16 i = 1; i <= ni; ++i)
		s.items[i] = l->itemData(i)->name;
}

// ---------------------------------------------------------------- JSON

static void appendItem(Common::String &list, const Common::String &item) {
	if (item.empty())
		return;
	if (!list.empty())
		list += ",";
	list += item;
}

// One room object in the shape the player expects (adapter.ts RoomObject, same
// field names as Drascula objectJson). `k` is the room-relative noun 1..objMax
// (brief section 1: global number = roomData(room) + k). Returns "" for a
// deleted object (name 0) unless `nameHint` carries its old name.
static Common::String objectJson(QueenEngine *vm, uint16 room, uint16 k, int16 nameHint) {
	Logic *l = vm->logic();
	uint16 gi = l->roomData(room) + k;
	if (gi > numObjects(l))
		return Common::String();
	ObjectData *od = l->objectData(gi);
	int16 nm = (od->name != 0) ? od->name : nameHint;
	if (nm == 0)
		return Common::String();

	// Box is x1,y1,x2,y2; the player wants x,y,w,h.
	const Box *b = vm->grid()->objectBox(gi);
	int w = MAX<int>(0, b->x2 - b->x1);
	int h = MAX<int>(0, b->y2 - b->y1);

	// A zero walk-to means "walk to where the player clicked" (command.cpp
	// makeJoeWalkTo uses the click when x and y are both 0), so fall back to the
	// bottom centre of the box.
	int wx = od->x;
	int wy = od->y;
	if (wx == 0 && wy == 0) {
		wx = (b->x1 + b->x2) / 2;
		wy = b->y2;
	}

	// An exit is open when entryObj > 0 (command.cpp:529-541); a closed door
	// has entryObj < 0 and becomes an exit only after it opens (brief section 1).
	bool door = od->entryObj > 0 && (uint16)od->entryObj <= numObjects(l);
	int toRoom = 0;
	if (door) {
		toRoom = l->objectData(od->entryObj)->room;
		// Exits walk to their own walk-off point (Command::makeJoeWalkTo).
		WalkOffData *wod = l->walkOffPointForObject((int16)gi);
		if (wod != nullptr) {
			wx = wod->x;
			wy = wod->y;
		}
	}

	Common::String json = Common::String::format(
		"{\"num\":%d,\"name\":\"%s\",\"rect\":[%d,%d,%d,%d],\"walkTo\":[%d,%d],"
		"\"visible\":%s,\"door\":%s",
		(int)k, jsonEscape(nameText(l, nm).c_str()).c_str(),
		(int)b->x1, (int)b->y1, w, h, wx, wy,
		od->name > 0 ? "true" : "false",
		door ? "true" : "false");
	if (door)
		json += Common::String::format(",\"toRoom\":%d", toRoom);
	json += "}";
	return json;
}

static Common::String roomObjectsJson(QueenEngine *vm, uint16 room) {
	Common::String list;
	uint16 objMax = vm->grid()->objMax(room);
	for (uint16 k = 1; k <= objMax; ++k)
		appendItem(list, objectJson(vm, room, k, 0));
	return list;
}

static Common::String roomStateJson(QueenEngine *vm) {
	Logic *l = vm->logic();
	uint16 room = l->currentRoom();
	BobSlot *joe = vm->graphics()->bob(0);

	Common::String json = Common::String::format(
		"{\"chapter\":%d,\"room\":%d,\"hero\":{\"x\":%d,\"y\":%d},\"objects\":[",
		kChapter, (int)room, (int)joe->x, (int)joe->y);
	json += roomObjectsJson(vm, room);

	json += "],\"inventory\":[";
	Common::String ids;
	for (uint16 i = 1; i <= l->itemDataCount(); ++i) {
		if (isCarried(l, i))
			appendItem(ids, Common::String::format("%d", (int)i));
	}
	json += ids;

	// All 211 game-state words, verbatim (brief section 1, flags).
	json += "],\"flags\":[";
	for (int i = 0; i < Logic::GAME_STATE_COUNT; ++i) {
		if (i > 0)
			json += ",";
		json += Common::String::format("%d", (int)l->gameState(i));
	}
	json += "]}";
	return json;
}

// ---------------------------------------------------------------- phase

static void emitPhase(Layer &s, int phase) {
	if (phase == s.phase)
		return;
	s.phase = phase;
	const char *name = phase == kPhaseControl ? "control" :
	                   phase == kPhaseChoice  ? "choice"  : "busy";
	emitLine(Common::String("A11Y_PHASE ") + name);
}

// ---------------------------------------------------------------- inventory

static void emitInv(QueenEngine *vm) {
	Logic *l = vm->logic();
	Common::String items;
	for (uint16 i = 1; i <= l->itemDataCount(); ++i) {
		if (!isCarried(l, i))
			continue;
		ItemData *id = l->itemData(i);
		Common::String one = Common::String::format("{\"id\":%d,\"name\":\"%s\"",
			(int)i, jsonEscape(nameText(l, id->name).c_str()).c_str());
		Common::String look = lookText(l, id->description);
		if (!look.empty())
			one += Common::String::format(",\"look\":\"%s\"", jsonEscape(look.c_str()).c_str());
		one += "}";
		appendItem(items, one);
	}
	emitLine(Common::String("A11Y_INV {\"items\":[") + items + "]}");
}

// True when the carried set differs from the last one reported (always true
// the first time, which gives the once-at-start A11Y_INV).
static bool carriedChanged(QueenEngine *vm, Layer &s) {
	Logic *l = vm->logic();
	Common::Array<byte> now;
	now.resize(l->itemDataCount() + 1);
	now[0] = 0;
	for (uint16 i = 1; i <= l->itemDataCount(); ++i)
		now[i] = isCarried(l, i) ? 1 : 0;

	bool changed = !s.invSeen || now.size() != s.lastCarried.size();
	for (uint i = 0; !changed && i < now.size(); ++i)
		changed = now[i] != s.lastCarried[i];
	if (changed) {
		s.lastCarried = now;
		s.invSeen = true;
	}
	return changed;
}

// ---------------------------------------------------------------- diff

// The command the engine is about to execute, as a short label such as
// "open 2" or "use 3 on 5". There is no command file yet, so this is the
// engine's own verb and nouns. A right click is resolved to the object's
// default verb exactly as Command::executeCurrentAction does at its top.
static Common::String describeAction(QueenEngine *vm) {
	Logic *l = vm->logic();
	const CmdState &st = vm->command()->cmdState();
	Verb v = st.selAction;

	if (vm->command()->mouseKey() == Input::MOUSE_RBUTTON && st.subject[0] > 0) {
		ObjectData *od = l->objectData(st.subject[0]);
		if (od->name > 0) {
			v = State::findDefaultVerb(od->state);
			if (v == VERB_NONE)
				v = VERB_WALK_TO;
		}
	}

	// subject[n] > 0 is a global object number, < 0 is an item id negated
	// (command.cpp grabSelectedItem passes -item).
	Common::String subj[2];
	for (int i = 0; i < 2; ++i) {
		int s = st.subject[i];
		if (s > 0)
			subj[i] = Common::String::format("%d", s - (int)l->currentRoomData());
		else if (s < 0)
			subj[i] = Common::String::format("%d", -s);
	}

	Common::String cmd = verbWord(v);
	if (!subj[0].empty())
		cmd += " " + subj[0];
	if (!subj[1].empty())
		cmd += Common::String(v == VERB_GIVE ? " to " : " on ") + subj[1];
	return cmd;
}

static void emitDiff(QueenEngine *vm) {
	Layer &s = layer();
	Logic *l = vm->logic();
	Snap now;
	takeSnap(vm, now);
	const Snap &was = s.before;

	bool changed = false;
	Common::String json = Common::String("A11Y_DIFF {\"cmd\":\"") + jsonEscape(s.cmd.c_str()) + "\"";

	if (now.room != was.room) {
		// Chapter never changes, so no "chapter" field. The whole new room is
		// reported, as in the Drascula diff (adapter.ts Diff.objects).
		json += Common::String::format(",\"room\":[%d,%d]", (int)was.room, (int)now.room);
		json += ",\"objects\":[" + roomObjectsJson(vm, now.room) + "]";
		changed = true;
	} else {
		Common::String appeared, disappeared, doors;
		uint16 first = l->roomData(now.room);
		uint16 objMax = vm->grid()->objMax(now.room);
		for (uint16 k = 1; k <= objMax; ++k) {
			uint gi = first + k;
			if (gi >= now.objs.size() || gi >= was.objs.size())
				break;
			const ObjSnap &a = was.objs[gi];
			const ObjSnap &b = now.objs[gi];
			bool wasVisible = a.name > 0;
			bool isVisible = b.name > 0;
			if (isVisible && !wasVisible) {
				appendItem(appeared, objectJson(vm, now.room, k, 0));
				changed = true;
			} else if (!isVisible && wasVisible) {
				appendItem(disappeared, objectJson(vm, now.room, k, a.name));
				changed = true;
			}
			// A closed exit (entryObj < 0) that became open (entryObj > 0), or
			// the reverse. The hatch in room 1 does exactly this (drive-open-hatch.txt).
			if ((a.entryObj > 0) != (b.entryObj > 0)) {
				appendItem(doors, objectJson(vm, now.room, k, a.name));
				changed = true;
			}
		}
		if (!appeared.empty())
			json += ",\"appeared\":[" + appeared + "]";
		if (!disappeared.empty())
			json += ",\"disappeared\":[" + disappeared + "]";
		if (!doors.empty())
			json += ",\"doors\":[" + doors + "]";
	}

	// Hero position, only when it moved. Does not set `changed` on its own.
	if (now.heroX != was.heroX || now.heroY != was.heroY)
		json += Common::String::format(",\"hero\":{\"x\":%d,\"y\":%d}", (int)now.heroX, (int)now.heroY);

	// Items gained and lost, ascending id. The journal never counts.
	{
		Common::String added, removed;
		uint ni = MIN(now.items.size(), was.items.size());
		for (uint i = 1; i < ni; ++i) {
			bool had = (int)i != ITEM_JOURNAL && was.items[i] > 0;
			bool has = (int)i != ITEM_JOURNAL && now.items[i] > 0;
			if (has && !had) {
				appendItem(added, Common::String::format("{\"id\":%d,\"name\":\"%s\"}", (int)i,
					jsonEscape(nameText(l, now.items[i]).c_str()).c_str()));
				changed = true;
			} else if (had && !has) {
				appendItem(removed, Common::String::format("{\"id\":%d,\"name\":\"%s\"}", (int)i,
					jsonEscape(nameText(l, was.items[i]).c_str()).c_str()));
				changed = true;
			}
		}
		if (!added.empty())
			json += ",\"invAdded\":[" + added + "]";
		if (!removed.empty())
			json += ",\"invRemoved\":[" + removed + "]";
	}

	// Every game-state word that moved. No noise filter yet: which words are
	// animation noise in Queen is unknown (brief section 1, flags).
	{
		Common::String flags;
		for (int i = 0; i < Logic::GAME_STATE_COUNT; ++i) {
			if (was.gs[i] != now.gs[i]) {
				if (!flags.empty())
					flags += ",";
				flags += Common::String::format("\"%d\":[%d,%d]", i, (int)was.gs[i], (int)now.gs[i]);
				changed = true;
			}
		}
		if (!flags.empty())
			json += ",\"flags\":{" + flags + "}";
	}

	// Spoken lines, speaker in `color` (the player never reads `color`).
	if (!s.said.empty()) {
		json += ",\"said\":[";
		for (uint i = 0; i < s.said.size(); ++i) {
			if (i > 0)
				json += ",";
			json += Common::String::format("{\"color\":\"%s\",\"text\":\"%s\"}",
				jsonEscape(s.said[i].color.c_str()).c_str(),
				jsonEscape(s.said[i].text.c_str()).c_str());
		}
		json += "]";
	}

	json += Common::String::format(",\"changed\":%s}", changed ? "true" : "false");
	emitLine(json);

	s.said.clear();
	s.pending = false;
	// The layer command that owned this diff is done. Only once its action
	// began: an earlier action's flush must not end a command still waiting
	// for its click.
	if (s.run.started) {
		s.run.active = false;
		s.run.started = false;
	}
}

// ---------------------------------------------------------------- commands

static const int kRoomHeight = 150;             // room zone height, panel below (brief section 1)
static const int kScreenWidth = 320;
static const uint32 kReadThrottleMs = 250;      // same cadence as Drascula onUpdateEvents
static const uint32 kChooseHoldMs = 1500;       // a pushed digit not consumed by then is forgotten
static const int kClickWaitFrames = 4;          // idle frames to wait for JWM_EXECUTE after a click
static const int kMaxScrolls = 60;

// Verb words and the keymapper action that selects the verb. Names are from
// queen.h (verb actions, input.cpp:31-40). One table so a rename is a one-line
// fix. -1 is "no verb" (walk).
struct VerbWord {
	const char *word;
	int action;
};

static const VerbWord kVerbWords[] = {
	{ "look", kActionLook },
	{ "open", kActionOpen },
	{ "close", kActionClose },
	{ "pick", kActionPickUp },
	{ "take", kActionPickUp },      // the player's wire word for pick up
	{ "talk", kActionTalk },
	{ "push", kActionMove },        // Queen has one Move verb
	{ "pull", kActionMove },
	{ "use", kActionUse },
	{ "walk", -1 }
};

// Digit keys 1..4: pick an inventory slot, or a dialogue option
// (input.cpp:119-130 maps these to VERB_DIGIT_n, talk.cpp:1316-1324).
static const int kSlotActions[4] = {
	kActionInvSlot1, kActionInvSlot2, kActionInvSlot3, kActionInvSlot4
};

static void emitErr(const Common::String &msg) {
	emitLine(Common::String("A11Y_ERR ") + msg);
}

// The one diff of a command that changes no state itself (state, inventory,
// save, choices, skip with nothing to skip), as Drascula emits it.
static void emitDone(const Common::String &cmd) {
	emitLine(Common::String("A11Y_DIFF {\"cmd\":\"") + jsonEscape(cmd.c_str()) + "\",\"changed\":false}");
}

static void pushEv(Common::Event &e) {
	g_system->getEventManager()->pushEvent(e);
}

// Same shape as the probe's pushAction.
static void pushAction(int action) {
	Common::Event e;
	e.type = Common::EVENT_CUSTOM_ENGINE_ACTION_START;
	e.customType = action;
	pushEv(e);
	e.type = Common::EVENT_CUSTOM_ENGINE_ACTION_END;
	pushEv(e);
}

// Same shape as the probe's pushRightClick, with the left button. The move
// comes first because selection reads the cursor position (command.cpp:575).
static void pushClick(int x, int y) {
	Common::Event e;
	e.mouse = Common::Point(x, y);
	e.type = Common::EVENT_MOUSEMOVE;
	pushEv(e);
	e.type = Common::EVENT_LBUTTONDOWN;
	pushEv(e);
	e.type = Common::EVENT_LBUTTONUP;
	pushEv(e);
}

static void pushWheel(bool up) {
	Common::Event e;
	e.type = up ? Common::EVENT_WHEELUP : Common::EVENT_WHEELDOWN;
	pushEv(e);
}

static bool parseNum(const Common::String &s, int &out) {
	if (s.empty() || s.size() > 5)
		return false;
	int v = 0;
	for (uint i = 0; i < s.size(); ++i) {
		if (s[i] < '0' || s[i] > '9')
			return false;
		v = v * 10 + (s[i] - '0');
	}
	out = v;
	return true;
}

static void splitWords(const Common::String &text, Common::Array<Common::String> &w) {
	Common::String cur;
	for (uint i = 0; i <= text.size(); ++i) {
		char c = (i < text.size()) ? text[i] : ' ';
		if (c == ' ' || c == '\t') {
			if (!cur.empty()) {
				w.push_back(cur);
				cur.clear();
			}
		} else {
			cur += c;
		}
	}
}

static Common::String firstWord(const Common::String &text) {
	Common::Array<Common::String> w;
	splitWords(text, w);
	if (w.empty())
		return Common::String();
	Common::String v = w[0];
	v.toLowercase();
	return v;
}

// ---- command file (same behaviour as engine/a11y.cpp readCommandFile)

static Common::FSNode commandFileNode() {
	Common::Path savePath = ConfMan.getPath("savepath");
	return Common::FSNode(savePath.appendComponent("a11y-cmd.txt"));
}

// Read the file, queue each non-blank line that is not a '#' comment, then
// truncate it so every line is consumed once. A missing file is silent.
static void readCommandFile(Layer &s) {
	Common::FSNode node = commandFileNode();
	if (!node.exists())
		return;
	Common::SeekableReadStream *in = node.createReadStream();
	if (!in)
		return;
	bool sawAny = false;
	while (!in->eos()) {
		Common::String line = in->readLine();
		if (in->err())
			break;
		line.trim();
		if (line.empty() || line[0] == '#')
			continue;
		s.queue.push_back(line);
		sawAny = true;
	}
	delete in;
	if (sawAny) {
		Common::SeekableWriteStream *out = node.createWriteStream();
		delete out;
	}
}

// ---- skip

// Echo, then push both skip actions: kActionSkipText ends a spoken line
// (input.cpp:110-111, talk.cpp:751-755) and kActionSkipCutaway ends a cutaway,
// honoured only while _canQuit (input.cpp:131-139), so the extra one is a
// no-op elsewhere. With no command of ours in flight the skip is its own
// command and gets the no-op diff Drascula gives it; inside a command the
// command's own diff covers it.
static void doSkip(Layer &s) {
	emitLine("A11Y_CMD skip");
	// An open dialogue menu reads a skip as the right click that ends the
	// conversation (input.cpp:77-79). Refuse it, leave the menu open.
	if (s.phase == kPhaseChoice) {
		emitErr("skip: a choice menu is open, use choose");
		return;
	}
	pushAction(kActionSkipText);
	pushAction(kActionSkipCutaway);
	if (!s.run.active)
		emitDone("skip");
}

// Take every queued skip out of the queue (others keep their order).
static void takeSkips(Layer &s) {
	uint i = 0;
	while (i < s.queue.size()) {
		if (firstWord(s.queue[i]) == "skip") {
			s.queue.remove_at(i);
			doSkip(s);
		} else {
			++i;
		}
	}
}

// Busy or command in flight: every queued command except skip is dropped, one
// error each (the wording of Drascula's busy drop, engine/a11y.cpp:3237).
static void dropQueued(Layer &s) {
	while (!s.queue.empty()) {
		s.queue.remove_at(0);
		emitErr("busy: commands dropped");
	}
}

// ---- verbs, walk, use

static int visibleSlot(Logic *l, uint16 item) {
	for (int i = 0; i < 4; ++i) {
		if (l->findInventoryItem(i) == item)
			return i;
	}
	return -1;
}

static uint32 slotSig(Logic *l) {
	uint32 v = 0;
	for (int i = 0; i < 4; ++i)
		v = (v << 8) | (uint32)(l->findInventoryItem(i) & 0xFF);
	return v;
}

// A screen point where the engine's own zone test returns object k, so the
// click cannot land on a neighbour (brief gotcha 6). The box centre first,
// then a 5x5 sample. The probe tested zone lookup in room coordinates and the
// click in screen coordinates (box minus scroll); same here.
static bool findClickPoint(QueenEngine *vm, uint16 room, uint16 k, int &sx, int &sy) {
	Logic *l = vm->logic();
	Grid *g = vm->grid();
	const Box *b = g->objectBox(l->roomData(room) + k);
	if (b->x2 <= b->x1 || b->y2 <= b->y1)
		return false;
	int scroll = vm->display()->horizontalScroll();
	for (int pass = 0; pass < 26; ++pass) {
		int x, y;
		if (pass == 0) {
			x = (b->x1 + b->x2) / 2;
			y = (b->y1 + b->y2) / 2;
		} else {
			int p = pass - 1;
			x = b->x1 + (b->x2 - b->x1) * (2 * (p % 5) + 1) / 10;
			y = b->y1 + (b->y2 - b->y1) * (2 * (p / 5) + 1) / 10;
		}
		int px = x - scroll;
		if (px < 0 || px >= kScreenWidth || y < 0 || y >= kRoomHeight)
			continue;
		uint16 zone = g->findZoneForPos(GS_ROOM, x, y);
		if (zone != 0 && g->findObjectNumber(zone) == k) {
			sx = px;
			sy = y;
			return true;
		}
	}
	return false;
}

static void failRun(QueenEngine *vm, const Common::String &msg) {
	Layer &s = layer();
	emitErr(msg);
	// Drop any half-built verb or item selection so the next command starts clean.
	vm->command()->clear(true);
	s.run = Run();
}

// One step of the command in flight; called once per idle frame (and once at
// start). Events pushed here are consumed by the update(true) that follows.
static void advanceRun(QueenEngine *vm) {
	Layer &s = layer();
	Run &r = s.run;
	if (!r.active || r.started || s.pending)
		return;
	Logic *l = vm->logic();

	for (;;) {
		switch (r.stage) {
		case kStageScroll: {
			// Scroll before the verb: a scroll after it could reset the verb.
			if (visibleSlot(l, r.item) >= 0) {
				r.stage = kStageVerb;
				continue;
			}
			uint32 sig = slotSig(l);
			if (r.scrolls > 0 && sig == r.lastSig) {
				if (r.flipped) {
					failRun(vm, Common::String::format("item %d cannot be scrolled into view", (int)r.item));
					return;
				}
				r.flipped = true;
				r.scrollDir = -r.scrollDir;
			}
			if (++r.scrolls > kMaxScrolls) {
				failRun(vm, Common::String::format("item %d cannot be scrolled into view", (int)r.item));
				return;
			}
			r.lastSig = sig;
			pushWheel(r.scrollDir < 0);
			return;
		}
		case kStageVerb:
			if (r.verbAction >= 0) {
				pushAction(r.verbAction);
				r.stage = (r.item != 0) ? kStageItem : kStageClick;
				return;
			}
			r.stage = kStageClick;
			continue;
		case kStageItem: {
			int slot = visibleSlot(l, r.item);
			if (slot < 0) {
				failRun(vm, Common::String::format("item %d is not in a visible slot", (int)r.item));
				return;
			}
			pushAction(kSlotActions[slot]);
			r.stage = kStageClick;
			return;
		}
		case kStageClick: {
			int x = 0, y = 0;
			if (!findClickPoint(vm, l->currentRoom(), r.noun, x, y)) {
				failRun(vm, Common::String::format("object %d has no clickable point", (int)r.noun));
				return;
			}
			pushClick(x, y);
			r.stage = kStageWait;
			r.wait = 0;
			return;
		}
		default:
			// kStageWait: the action starts at JWM_EXECUTE (queen.cpp:372), and
			// onBeforeAction sets r.started. Reaching an idle frame first means
			// the engine did not take the click.
			if (++r.wait > kClickWaitFrames)
				failRun(vm, "the game did not act on the command");
			return;
		}
	}
}

// Validate a `<verb> N` or `use [I] N` command and start it.
static void startVerb(QueenEngine *vm, const Common::String &text,
                      const Common::Array<Common::String> &w, int action, bool isUse) {
	Layer &s = layer();
	Logic *l = vm->logic();
	Common::String verb = w[0];
	verb.toLowercase();

	int item = 0, noun = 0;
	if (w.size() == 1) {
		emitErr(Common::String::format("%s needs an object number, e.g. `%s 3`", verb.c_str(), verb.c_str()));
		return;
	}
	if (isUse && w.size() == 3) {
		if (!parseNum(w[1], item) || !parseNum(w[2], noun)) {
			emitErr(Common::String("use needs two numbers, an item and an object, got: ") + text);
			return;
		}
	} else if (w.size() == 2) {
		if (!parseNum(w[1], noun)) {
			emitErr(Common::String("object must be a number, got: ") + w[1]);
			return;
		}
	} else {
		emitErr(Common::String("too many arguments: ") + text);
		return;
	}

	uint16 room = l->currentRoom();
	if (noun < 1 || noun > (int)vm->grid()->objMax(room) ||
	    l->roomData(room) + noun > numObjects(l)) {
		emitErr(Common::String::format("object %d is not in this room", noun));
		return;
	}
	ObjectData *od = l->objectData(l->roomData(room) + noun);
	if (od->name == 0) {
		emitErr(Common::String::format("object %d is not in this room", noun));
		return;
	}
	if (od->name < 0) {
		emitErr(Common::String::format("object %d is not visible right now", noun));
		return;
	}
	if (isUse && w.size() == 3) {
		if (item < 1 || item > (int)l->itemDataCount() || !isCarried(l, (uint16)item)) {
			emitErr(Common::String::format("item %d is not in the inventory", item));
			return;
		}
	}
	int sx, sy;
	if (!findClickPoint(vm, room, (uint16)noun, sx, sy)) {
		emitErr(Common::String::format("object %d has no clickable point", noun));
		return;
	}

	// Start from no verb and no half-built command, then run the stages.
	vm->command()->clear(true);
	s.run = Run();
	s.run.active = true;
	s.run.text = text;
	s.run.verbAction = action;
	s.run.item = (uint16)item;
	s.run.noun = (uint16)noun;
	s.run.stage = (item != 0) ? kStageScroll : kStageVerb;
	emitPhase(s, kPhaseBusy);
	advanceRun(vm);
}

// ---- save, room

static void startSave(QueenEngine *vm, const Common::String &text, const Common::Array<Common::String> &w) {
	int slot = 0;
	if (w.size() != 2 || !parseNum(w[1], slot)) {
		emitErr("save needs a slot number, e.g. `save 1`");
		return;
	}
	// Queen slots run 1 to 99 (metaengine.cpp:77).
	if (slot < 1 || slot > 99) {
		emitErr(Common::String::format("save slot must be 1 to 99, got: %d", slot));
		return;
	}
	if (!vm->canSaveGameStateCurrently()) {
		emitErr("cannot save right now");
		return;
	}
	Common::Error result = vm->saveGameState(slot, Common::String::format("Ghostlight %d", slot));
	if (result.getCode() != Common::kNoError) {
		emitErr(Common::String::format("save to slot %d failed", slot));
		return;
	}
	emitLine(Common::String::format("A11Y_SAVED {\"slot\":%d}", slot));
	emitDone(text);
}

// Survey-only teleport, the same three calls as Debugger::Cmd_Room (debug.cpp:177),
// as the probe's jumpTo does. The room change itself happens on the next run
// loop pass (queen.cpp:360-366), and the diff, armed here, is flushed by the
// next onIdle after the A11Y line of the new room.
static void startRoom(QueenEngine *vm, const Common::String &text, const Common::Array<Common::String> &w) {
	Layer &s = layer();
	Logic *l = vm->logic();
	const char *env = getenv("GHOSTLIGHT_SURVEY");
	if (env == nullptr || *env == '\0') {
		emitErr("room is only available in survey mode");
		return;
	}
	int n = 0;
	if (w.size() != 2 || !parseNum(w[1], n)) {
		emitErr("room needs a room number, e.g. `room 3`");
		return;
	}
	if (n < 1 || n > (int)l->numRooms()) {
		emitErr(Common::String::format("room %d is out of range 1 to %d", n, (int)l->numRooms()));
		return;
	}
	// The pinnacle waits for a click and the logo room plays the whole intro
	// (probe isSpecialRoom), so a teleport there would hang the command.
	if (n == ROOM_JUNGLE_PINNACLE || n == FOTAQ_LOGO) {
		emitErr(Common::String::format("room %d cannot be entered by teleport", n));
		return;
	}
	// A room the data lists but this version does not ship would assert in
	// Resource::loadFile (probe nextJump).
	Common::String pcx = Common::String::format("%s.%s", l->roomName((uint16)n),
		vm->resource()->getPlatform() == Common::kPlatformAmiga ? "LBM" : "PCX");
	Common::String bbk = Common::String::format("%s.BBK", l->roomName((uint16)n));
	if (!vm->resource()->fileExists(pcx.c_str()) || !vm->resource()->fileExists(bbk.c_str())) {
		emitErr(Common::String::format("room %d is not in this version of the game", n));
		return;
	}

	takeSnap(vm, s.before);
	s.cmd = text;
	s.said.clear();
	s.pending = true;
	s.run = Run();
	s.run.active = true;
	s.run.started = true;
	s.run.text = text;
	s.roomSeen = false;     // force the A11Y line even for the same room
	emitPhase(s, kPhaseBusy);

	l->joePos(0, 0);
	l->newRoom((uint16)n);
	l->entryObj(l->roomData((uint16)n) + 1);
}

// ---- choose

// `choose K` from the update() hook while the menu is open: push digit key K
// (talk.cpp:1316-1324 picks the Kth non-empty option, same numbering as the
// A11Y_CHOICES "n"). The diff is the one armed by onChoices; it goes out when
// the next menu opens or at the next idle frame.
static void handleChoose(QueenEngine *vm, const Common::String &text) {
	Layer &s = layer();
	emitLine(Common::String("A11Y_CMD ") + text);
	Common::Array<Common::String> w;
	splitWords(text, w);
	int n = 0;
	if (w.size() != 2 || !parseNum(w[1], n)) {
		emitErr("choose needs an option number, e.g. `choose 1`");
		return;
	}
	if (n < 1 || n > s.choiceCount || n > 4) {
		emitErr(Common::String::format("option %d is not offered", n));
		return;
	}
	takeSnap(vm, s.before);
	s.cmd = text;
	s.said.clear();
	s.pending = true;
	s.run = Run();
	s.run.active = true;
	s.run.started = true;
	s.run.text = text;
	s.chooseBlockedUntil = g_system->getMillis() + kChooseHoldMs;
	pushAction(kSlotActions[n - 1]);
}

// Commands that arrive while a nested loop runs (busy or a menu): skip is
// honoured, choose and choices are honoured in a menu, the rest is dropped.
static void serviceNested(QueenEngine *vm, Layer &s) {
	if (!g_system)
		return;
	uint32 now = g_system->getMillis();
	if (s.lastReadMs == 0 || now - s.lastReadMs >= kReadThrottleMs) {
		s.lastReadMs = now;
		readCommandFile(s);
	}
	takeSkips(s);

	uint i = 0;
	while (i < s.queue.size()) {
		Common::String line = s.queue[i];
		Common::String v = firstWord(line);
		bool inMenu = (s.phase == kPhaseChoice);
		if (inMenu && v == "choose" && now >= s.chooseBlockedUntil) {
			s.queue.remove_at(i);
			handleChoose(vm, line);
		} else if (inMenu && v == "choices") {
			s.queue.remove_at(i);
			emitLine(Common::String("A11Y_CMD ") + line);
			emitLine(s.choicesLine);
			emitDone(line);
		} else {
			s.queue.remove_at(i);
			emitErr("busy: commands dropped");
		}
	}
}

// Start one queued command at the idle branch.
static void startCommand(QueenEngine *vm, const Common::String &text) {
	emitLine(Common::String("A11Y_CMD ") + text);

	Common::Array<Common::String> w;
	splitWords(text, w);
	Common::String verb = w[0];
	verb.toLowercase();

	if (verb == "state") {
		emitLine(Common::String("A11Y ") + roomStateJson(vm));
		emitDone(text);
		return;
	}
	if (verb == "inventory" || verb == "inv") {
		emitInv(vm);
		emitDone(text);
		return;
	}
	if (verb == "save") {
		startSave(vm, text, w);
		return;
	}
	if (verb == "room") {
		startRoom(vm, text, w);
		return;
	}
	if (verb == "choose" || verb == "choices") {
		emitErr("no conversation is open");
		return;
	}
	for (uint i = 0; i < ARRAYSIZE(kVerbWords); ++i) {
		if (verb == kVerbWords[i].word) {
			startVerb(vm, text, w, kVerbWords[i].action, verb == "use");
			return;
		}
	}
	emitErr(Common::String("no handler for command: ") + text);
}

// ---------------------------------------------------------------- hooks

void init(QueenEngine *) {
	// The first idle frame reports the room, the inventory and control. Until
	// then the engine is still starting up.
	emitPhase(layer(), kPhaseBusy);
}

void onIdle(QueenEngine *vm) {
	Layer &s = layer();

	// 1. Room change (also the first room). A command-driven change is carried
	//    by the A11Y line first and then by the diff, so both agree.
	uint16 room = vm->logic()->currentRoom();
	if (!s.roomSeen || room != s.lastRoom) {
		emitLine(Common::String("A11Y ") + roomStateJson(vm));
		s.roomSeen = true;
		s.lastRoom = room;
	}

	// 2. The diff of the action that just settled.
	if (s.pending)
		emitDiff(vm);

	// 3. Carried items changed (or first idle frame).
	if (carriedChanged(vm, s))
		emitInv(vm);

	// 4. Idle branch reached: a layer command may run and the player is in
	//    control, unless a cutaway is running (brief section 1, phase).
	bool inControl = !vm->input()->cutawayRunning();

	// 5. Command file. Only here, at the idle branch, does a command start. A
	//    skip is always honoured. Anything else while a cutaway runs or while
	//    one of our commands is in flight is dropped with one error each.
	readCommandFile(s);
	takeSkips(s);
	if (!inControl || s.run.active) {
		dropQueued(s);
		// Never push a click into a cutaway.
		if (inControl)
			advanceRun(vm);
	} else if (!s.queue.empty()) {
		Common::String next = s.queue[0];
		s.queue.remove_at(0);
		startCommand(vm, next);
		// Whatever else was queued behind it is busy now (or waits for the
		// next frame when the command was instant).
		if (s.run.active)
			dropQueued(s);
	}

	// 6. No command in flight and no cutaway: the player is in control.
	if (inControl && !s.run.active)
		emitPhase(s, kPhaseControl);

	// The update(true) call right after this hook is the idle frame itself.
	s.idleToken = true;
}

void onBeforeAction(QueenEngine *vm) {
	Layer &s = layer();
	// Two actions without an idle frame between them: close the first one.
	if (s.pending)
		emitDiff(vm);
	takeSnap(vm, s.before);
	// A layer command keeps the text as typed (the diff's cmd); anything else
	// (a stray click, a script) is named from the engine's own verb and nouns.
	if (s.run.active) {
		s.cmd = s.run.text;
		s.run.started = true;
	} else {
		s.cmd = describeAction(vm);
	}
	s.said.clear();
	s.pending = true;
	emitPhase(s, kPhaseBusy);
}

void onUpdate(QueenEngine *vm) {
	Layer &s = layer();
	if (s.idleToken) {
		s.idleToken = false;
		return;
	}
	// Walk, speech and cutaway loops call update() themselves (walk.cpp:126-134,
	// talk.cpp:740-745), so the player is not at the controls. A choice menu
	// keeps its own phase.
	if (s.phase == kPhaseControl)
		emitPhase(s, kPhaseBusy);
	// Skip, and choose in a menu, are served here (the nested loops all pump
	// update()); every other command is dropped.
	serviceNested(vm, s);
}

void onChoices(QueenEngine *vm, const char *o1, const char *o2, const char *o3, const char *o4) {
	Layer &s = layer();
	// The action that opened the menu (talk, or the previous pick) has settled.
	if (s.pending)
		emitDiff(vm);

	const char *opts[4] = { o1, o2, o3, o4 };
	Common::String list;
	int n = 0;
	for (int i = 0; i < 4; ++i) {
		if (!opts[i] || opts[i][0] == '\0')
			continue;
		// n is the visible order: digit N picks the Nth non-empty option
		// (talk.cpp:1316-1324), not the slot number.
		++n;
		appendItem(list, Common::String::format("{\"n\":%d,\"text\":\"%s\"}", n,
			jsonEscape(cleanText(opts[i]).c_str()).c_str()));
	}
	if (n == 0)
		return;
	emitLine(Common::String("A11Y_CHOICES {\"choices\":[") + list + "]}");
	s.choicesLine = Common::String("A11Y_CHOICES {\"choices\":[") + list + "]}";
	s.choiceCount = n;
	s.chooseBlockedUntil = 0;
	emitPhase(s, kPhaseChoice);

	// No diff is armed here. Only handleChoose arms one, under the player's
	// own `choose N`, so a diff never carries a cmd the player did not send.
	// If the engine leaves the conversation by itself, its spoken lines still
	// go out as A11Y_TEXT and the next command's diff reports the state change.
}

void onSpeak(QueenEngine *, const char *speaker, const char *sentence) {
	Layer &s = layer();
	Common::String text = cleanText(sentence);
	if (text.empty())
		return;
	// A line spoken outside an idle frame or a menu is the engine talking.
	if (s.phase == kPhaseControl || s.phase == kPhaseChoice)
		emitPhase(s, kPhaseBusy);
	s.chooseBlockedUntil = 0;
	// Floppy has no speech, so always A11Y_TEXT and never A11Y_VTEXT.
	emitLine(Common::String("A11Y_TEXT ") + text);
	if (s.pending) {
		SaidLine line;
		line.color = speaker ? speaker : "";
		line.text = text;
		s.said.push_back(line);
	}
}

} // End of namespace A11y
} // End of namespace Queen
