export class TileLightingDecodeError extends Error {
  constructor(message: string) {
    super(`Tile lighting: ${message}`);
    this.name = "TileLightingDecodeError";
  }
}
