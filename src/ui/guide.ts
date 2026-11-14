// The "How to play" guide on the start screen (tester feedback, 14 Nov).
//
// The first room used to end with a long list of keys, which was too much at
// once. The guide moves that teaching before the game starts: five short pages,
// each a heading plus a few lines, that a screen-reader user reads at their own
// pace in browse mode. A first-time player is offered it with a skip; a
// returning player gets it as a button after Start / Continue. Seeing it once
// is remembered in localStorage (wrapped: storage can be missing or throw).
//
// On each page change focus moves to the page heading (tabindex -1), so the
// screen reader announces the new page by itself; nothing goes to the live
// region, so nothing is read twice.

export const GUIDE_SEEN_KEY = "ghostlight.guideSeen";

export interface GuidePage {
  title: string;
  lines: string[];
}

/** The five pages. `tip` is the platform-aware screen-reader tip sentence. */
export function guidePages(tip: string): GuidePage[] {
  return [
    {
      title: "Moving around",
      lines: [
        "Left and Right arrows move through the people, things and exits in a room.",
        "Enter talks to, uses or goes through what you're on. Down arrow examines it.",
        "L reads the whole room again. R repeats the last line, and Shift plus R steps back through earlier lines.",
      ],
    },
    {
      title: "Using things",
      lines: [
        "Tab opens your inventory. Choose an item, then press Enter on something in the room to use the item on it. Backspace cancels.",
        "V gives more actions, like open, close and push.",
        "Slash opens a box where you type a command, like use coins on machine, then press Enter.",
      ],
    },
    {
      title: "Talking",
      lines: [
        "When you talk to someone, a reply menu opens. Up and Down move through the replies, Enter or a number picks one, and R reads them again.",
        "The actors speak their lines aloud. D makes your screen reader read them too.",
      ],
    },
    {
      title: "Getting help",
      lines: [
        "Each room tells you what's worth a look, straight after its name.",
        "Stuck? H gives a clue. Press H again for the answer.",
        "The ghost speaks its hints aloud. G turns its voice off, and the hint is read as text instead.",
        "S plays a sonar sweep of the room from left to right. N and P step through things one at a time, and M mutes it.",
      ],
    },
    {
      title: "Saving and more",
      lines: [
        "The game saves by itself each time you enter a new room. C saves now, and O loads your latest save.",
        "F1 or question mark lists every key at any time.",
        tip,
      ],
    },
  ];
}

/** True when this browser has already seen or skipped the guide. */
export function guideSeen(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(GUIDE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remember that the guide was seen or skipped. */
export function markGuideSeen(storage: Storage | undefined): void {
  try {
    storage?.setItem(GUIDE_SEEN_KEY, "1");
  } catch {
    /* storage unavailable: the guide is simply offered again next time. */
  }
}

export interface GuideOptions {
  doc: Document;
  /** Where the pages render (the gate's actions container). */
  container: HTMLElement;
  pages: GuidePage[];
  /** Label of the last page's finish button, e.g. "Start the game". */
  finishLabel: string;
  /** Called on finish or skip. */
  onDone: () => void;
}

/** Renders the guide pages one at a time, each with a single Next button. */
export class Guide {
  private index = 0;
  constructor(private readonly o: GuideOptions) {}

  open(): void {
    this.show(0);
  }

  private show(i: number): void {
    const { doc, container, pages } = this.o;
    this.index = Math.max(0, Math.min(i, pages.length - 1));
    const page = pages[this.index];
    const last = this.index === pages.length - 1;

    // A plain container, not a labelled region: a region would make VoiceOver
    // and NVDA add "region" to every page change.
    const section = doc.createElement("div");
    section.id = "guide";

    const heading = doc.createElement("h2");
    heading.id = "guide-title";
    heading.tabIndex = -1;
    heading.textContent = `${page.title}, page ${this.index + 1} of ${pages.length}`;

    const list = doc.createElement("ul");
    for (const line of page.lines) {
      const li = doc.createElement("li");
      li.textContent = line;
      list.append(li);
    }

    const nav = doc.createElement("div");
    nav.id = "guide-nav";
    // One button per page (Kash, 14 Nov): the guide-or-skip choice is made
    // once, on the start screen. Reading down a page ends on this button, so a
    // screen-reader user never has to choose between Back, Next and Skip; a
    // player who opened the guide by mistake just presses Next through it.
    nav.append(
      last
        ? this.button("guide-finish", this.o.finishLabel, () => this.o.onDone())
        : this.button("guide-next", "Next", () => this.show(this.index + 1)),
    );

    section.append(heading, list, nav);
    container.replaceChildren(section);
    heading.focus();
  }

  private button(id: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = this.o.doc.createElement("button");
    b.id = id;
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
}
