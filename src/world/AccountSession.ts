import type { GameWorldAdapter } from "./GameWorldAdapter";

export type AccountSessionState =
  | { readonly stage: "login" }
  | { readonly stage: "server-list" }
  | { readonly stage: "character-selection" }
  | { readonly stage: "in-world"; readonly world: GameWorldAdapter };

export interface AccountSession {
  state(): AccountSessionState;
  subscribe(listener: (state: AccountSessionState) => void): () => void;
}
