/**
 * Drascula's target number for the hero (the player's own character). The
 * engine command `use <item> 50` uses an item on yourself; the engine layer
 * handles it in dispatchUse / useItemOnSelf (engine/a11y.cpp). The one place
 * in the player that knows this number: the command box and the inventory
 * both import it, so it is never written as a bare 50 anywhere else.
 */
export const HERO_TARGET = 50;
