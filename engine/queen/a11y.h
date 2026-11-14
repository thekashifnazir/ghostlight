/* Ghostlight - accessibility layer for the ScummVM Queen engine
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
 * The hooks and read-only accessors that call this layer are in hooks.patch.
 */

#ifndef QUEEN_A11Y_H
#define QUEEN_A11Y_H

#include "common/scummsys.h"

// Accessibility layer for Flight of the Amazon Queen. It reports engine
// state as A11Y lines (the same format as the Drascula layer) and runs
// commands from <savepath>/a11y-cmd.txt by pushing the input events a
// player would make.
//
// Each hook is a free function, so each hook in hooks.patch is one line.
// State lives in one lazily allocated struct (ScummVM forbids global
// constructors), so a hook that fires before init() is safe.

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

} // End of namespace A11y
} // End of namespace Queen

#endif
