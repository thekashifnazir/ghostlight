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
 * engines/queen of the pinned ScummVM checkout by the build (the matching
 * one-line hooks and read-only accessors live in engine/queen/hooks.patch).
 * Never edit the checkout by hand.
 */

#ifndef QUEEN_A11Y_H
#define QUEEN_A11Y_H

#include "common/scummsys.h"

// Ghostlight layer for Flight of the Amazon Queen. Read side: it observes the
// engine and writes A11Y lines (same wire format as the Drascula layer, see
// src/engine/a11y-lines.ts). Command side: it reads <savepath>/a11y-cmd.txt
// and runs state, look/open/close/pick/take/talk/push/pull/walk/use, choose,
// choices, skip, inventory, save and the survey-only room, by pushing the same
// input events a player makes. Same hooks as before, no new ones.
//
// Every hook below is a free function so each hook in hooks.patch is one line.
// All state lives in one lazily allocated struct inside a11y.cpp (ScummVM
// forbids global constructors), so a hook that fires before init() is safe.

namespace Queen {

class QueenEngine;

namespace A11y {

//! QueenEngine::run, after Logic::start(): announce the initial busy phase.
void init(QueenEngine *vm);

//! QueenEngine::run, idle branch before update(true): room change, pending
//! diff, inventory change, then the command file (one command starts, or the
//! one in flight takes its next step), then the control phase.
void onIdle(QueenEngine *vm);

//! QueenEngine::run, JWM_EXECUTE branch before executeCurrentAction():
//! snapshot the state and name the action about to run.
void onBeforeAction(QueenEngine *vm);

//! QueenEngine::update, first statement: a call that did not come straight
//! from the idle branch is a nested loop (walk, speech, cutaway, menu), so
//! busy. It also reads the command file (throttled to 250 ms), serves skip and
//! choose, and drops every other queued command with an A11Y_ERR.
void onUpdate(QueenEngine *vm);

//! Talk::selectSentence, before its loop: the four Joe options (an empty
//! string means the slot is not offered).
void onChoices(QueenEngine *vm, const char *o1, const char *o2, const char *o3, const char *o4);

//! Talk::speak, after the empty-sentence check: one call per spoken line.
void onSpeak(QueenEngine *vm, const char *speaker, const char *sentence);

//! g_system->getMillis() of the last line written (0 before the first line).
//! Read by the busy watchdog the command side will add.
uint32 lastOutputMs();

} // End of namespace A11y
} // End of namespace Queen

#endif
