/* Ghostlight — accessibility layer for the ScummVM Drascula engine
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
 * This file is NEW code added to a GPL ScummVM fork. It is copied into the
 * pinned checkout under vendor/ by scripts/build-engine.sh. Never edit vendor/.
 */

#include "drascula/a11y.h"

namespace Drascula {

// Scaffold only. Implementation lands in tasks 3 onward:
//   task 3  onStartup(): intro skip assert, subtitles guard, first room state
//   task 4  onRoomEntry(): build and emit the A11Y room-state JSON
//   task 5  poll(): command file reader and queue
//   tasks 7-17  dispatch, diff, conversations, cutscene skip, etc.

A11yLayer::A11yLayer(DrasculaEngine *engine) : _engine(engine) {
}

void A11yLayer::onStartup() {
}

void A11yLayer::onRoomEntry() {
}

void A11yLayer::poll() {
}

} // namespace Drascula
