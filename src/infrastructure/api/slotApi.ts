// Backend slot API client (BlitzGamingBackoffice /api/v1).
// Mirrors the onepiece integration style: bearer token auth + session lifecycle + backend-authoritative outcomes.
type BackendErrorResponse = {
  error?: boolean;
  code?: string;
  message?: string;
  success?: boolean;
};

// Backend uses column-major reel grid: [column][row] where symbols are string names.
export type BackendReel = string[][];

export type BackendWinning = {
  symbol: string;
  payout: number;
  ways: number;
  hasWild?: boolean;
  direction?: string;
  length: number;
  positions?: { col: number; row: number }[];
};

export type BackendCascadeStep = {
  winnings: BackendWinning[];
  rng: BackendReel;
  type?: string;
  win: number;
  multiplier: number;
  cascades: { column: number; row: number; symbol: string }[];
};

export type BackendSlot = {
  reel: BackendReel;
  winnings?: BackendWinning[];
  cascaded?: BackendCascadeStep[] | null;
};

export type BackendFreeSpin = {
  count: number;
  scatterCount?: number | null;
  retrigger?: boolean;
  add?: number | null;
};

export type BackendMachineConfig = {
  machine_id: number;
  min_bet?: number;
  max_bet?: number;
  bet_sizes?: number[];
  bet_levels?: number[];
  default?: { bet_size: number; bet_level: number };
  multiplier?: number;
  free_spin_cost?: number;
};

export type BackendLoadData = {
  player: { balance: number; currency?: string };
  machine?: BackendMachineConfig;
  info?: { base_multiplier?: number };
  slot?: { reel?: BackendReel } | null;
  jackpot_prizes?: Record<string, unknown> | null;
  free_spin?: { count: number; total_win?: number } | null;
};

export type BackendPlayData = {
  win: number;
  total_win: number;
  balance: number;
  bet_size?: number;
  bet_level?: number;
  free_spin?: BackendFreeSpin | null;
  is_free_spin?: boolean;
  slot: BackendSlot;
  jackpot_prizes?: Record<string, unknown> | null;
  max_win_hit?: boolean;
  jackpot_hit?: boolean;
  jackpot_type?: "mini" | "major" | "super";
};

export type BackendResponse<T> = { success: boolean; data: T };

type SessionInfo = {
  session_id: string;
  status: string;
  balance: number;
  started_at: string;
};

// Local symbol mapping:
// Backend symbols: s4,s3,s2,s1,a,k,q,j,wild,sc
// my-project-golden symbols (0..9): apple, banana, lemonade, mangga, a, k, q, j, wild, scatter
const SYMBOL_NAME_TO_INDEX: Record<string, number> = {
  // fruits
  s1: 0,
  s2: 1,
  s3: 2,
  s4: 3,
  // letters
  a: 4,
  k: 5,
  q: 6,
  j: 7,
  // specials
  wild: 8,
  sc: 9,
};

export function symbolNameToIndex(name: string): number {
  const n = String(name).toLowerCase();
  return SYMBOL_NAME_TO_INDEX[n] ?? 0;
}

let apiBaseUrl = "http://192.168.150.139:8000/api/v1";
let authToken: string | null = null;
let currentSessionId: string | null = null;
let roundCounter = 0;
let machineId: number | null = null;

export function setSlotApiBaseUrl(url: string) {
  apiBaseUrl = url.replace(/\/$/, "");
}

export function setAuthToken(token: string | null) {
  authToken = token?.trim() ? token.trim() : null;
  currentSessionId = null;
}

export function setMachineId(id: number | null) {
  machineId = typeof id === "number" && Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

function nextRoundId(): string {
  roundCounter += 1;
  return `r-${Date.now()}-${roundCounter}`;
}

async function fetchApi<T>(path: string, body?: object): Promise<T> {
  if (!authToken) {
    throw new Error("Missing token. Please launch the game from the lobby (?token=...).");
  }

  const url = `${apiBaseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body ?? {}),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // ignore JSON parse errors
  }

  if (!res.ok) {
    const err = json as BackendErrorResponse | null;
    throw new Error(err?.message || `Slot API ${path}: ${res.status}`);
  }

  const err = json as BackendErrorResponse | null;
  if (err?.error === true || err?.success === false) {
    throw new Error(err?.message || "API error");
  }

  return json as T;
}

/** POST /session/start – start and cache session_id. */
export async function ensureSession(): Promise<SessionInfo> {
  if (currentSessionId) {
    return { session_id: currentSessionId, status: "active", balance: 0, started_at: "" };
  }

  const out = await fetchApi<BackendResponse<SessionInfo>>("/session/start", {});
  currentSessionId = out.data.session_id;
  return out.data;
}

/** POST /session/end – best-effort session close. Safe to call multiple times. */
export async function endSession(): Promise<void> {
  if (!currentSessionId) return;
  const sessionId = currentSessionId;
  try {
    await fetchApi<BackendResponse<unknown>>("/session/end", { session_id: sessionId });
  } finally {
    if (currentSessionId === sessionId) currentSessionId = null;
  }
}

/** Best-effort session end for page close (keepalive). */
export function endSessionOnClose(): void {
  if (!currentSessionId || !authToken) return;
  const sessionId = currentSessionId;
  currentSessionId = null;

  void fetch(`${apiBaseUrl}/session/end`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
    keepalive: true,
  }).catch(() => {});
}

/** POST /load – get initial balance, free spin count, machine config, jackpot prizes. */
export async function load(): Promise<BackendLoadData> {
  await ensureSession();
  const out = await fetchApi<BackendResponse<BackendLoadData>>("/load", {
    session_id: currentSessionId,
    machine_id: machineId ?? undefined,
  });

  const newMachineId = out.data.machine?.machine_id;
  if (typeof newMachineId === "number") setMachineId(newMachineId);

  // Backwards compatibility: some responses may include freeSpinWin instead of total_win.
  if (out.data.free_spin && (out.data as any).free_spin.freeSpinWin !== undefined) {
    const fs: any = out.data.free_spin;
    fs.total_win = fs.total_win ?? fs.freeSpinWin;
  }

  return out.data;
}

/** POST /play – paid spin. Sends only bet_size and bet_level; backend computes bet amount. */
export async function play(betSize: number, betLevel: number = 1): Promise<BackendPlayData> {
  await ensureSession();
  const out = await fetchApi<BackendResponse<BackendPlayData>>("/play", {
    session_id: currentSessionId,
    round_id: nextRoundId(),
    machine_id: machineId ?? undefined,
    bets: { bet_size: betSize, bet_level: betLevel },
  });
  return out.data;
}

/** POST /play-free-game – one free spin. */
export async function playFreeGame(): Promise<BackendPlayData> {
  await ensureSession();
  const out = await fetchApi<BackendResponse<BackendPlayData>>("/play-free-game", {
    session_id: currentSessionId,
    round_id: nextRoundId(),
    machine_id: machineId ?? undefined,
  });
  return {
    ...out.data,
    free_spin: out.data.free_spin ?? null,
    // play-free-game is always a free-spin round; Laravel sets this, but default for robustness.
    is_free_spin: out.data.is_free_spin ?? true,
  };
}

/** POST /buy-free-game – buy free spins. Sends only bet_size and bet_level. */
export async function buyFreeGame(betSize: number, betLevel: number = 1): Promise<BackendPlayData> {
  await ensureSession();
  const out = await fetchApi<BackendResponse<BackendPlayData>>("/buy-free-game", {
    session_id: currentSessionId,
    round_id: nextRoundId(),
    machine_id: machineId ?? undefined,
    bets: { bet_size: betSize, bet_level: betLevel },
  });
  return out.data;
}

export function backendReelToGrid(reel: BackendReel): number[][] {
  const indexGrid = reel.map((col) => col.map((name) => symbolNameToIndex(name)));

  // Defensive transpose: if backend accidentally sends row-major [row][col], flip it.
  if (indexGrid.length > 0 && indexGrid[0].length > indexGrid.length) {
    const transposed: number[][] = [];
    const numCols = indexGrid[0].length;
    const numRows = indexGrid.length;
    for (let c = 0; c < numCols; c++) {
      transposed[c] = [];
      for (let r = 0; r < numRows; r++) transposed[c][r] = indexGrid[r][c];
    }
    return transposed;
  }

  return indexGrid;
}
