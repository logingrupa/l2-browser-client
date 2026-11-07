import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";

const boundary = vi.hoisted(() => ({ create: vi.fn(), load: vi.fn(), reveal: vi.fn(), error: vi.fn() }));
vi.mock("../../src/engine/EngineHost", () => ({ EngineHost: { create: boundary.create } }));
vi.mock("../../src/scene/loadEnvironment", () => ({ loadEnvironment: boundary.load }));
vi.mock("../../src/scene/prepareSceneForReveal", () => ({ prepareSceneForReveal: boundary.reveal }));
vi.mock("../../src/ui/LoadingScreen", () => ({ showLoadingError: boundary.error }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

class Canvas {
  readonly dataset: Record<string, string> = {};
}
const makeHost = () => ({ engine: {}, dispose: vi.fn(), run: vi.fn(), setLoadingStatus: vi.fn() });

/** Control only the asynchronous graphics/scene boundaries. These races happen
 * when pagehide or a development hot reload arrives during WebGPU setup. */
describe("application asynchronous graphics startup", () => {
  let app: App, canvas: Canvas;
  let body: { dataset: Record<string, string> };
  let loading: { remove: ReturnType<typeof vi.fn> }, interfaceRoot: { removeAttribute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    boundary.create.mockReset(); boundary.load.mockReset(); boundary.reveal.mockReset(); boundary.error.mockReset();
    canvas = new Canvas(); body = { dataset: { worldState: "loading" } };
    loading = { remove: vi.fn() }; interfaceRoot = { removeAttribute: vi.fn() };
    vi.stubGlobal("HTMLCanvasElement", Canvas);
    vi.stubGlobal("document", {
      body,
      getElementById: (id: string) => id === "canvas" ? canvas : id === "app" ? interfaceRoot : id === "loading" ? loading : null,
    });
    app = new App();
  });
  afterEach(() => { app.dispose(); vi.unstubAllGlobals(); });

  it("waits for initialized graphics before loading a scene and retains the loader until its first ready frame", async () => {
    const graphics = deferred<ReturnType<typeof makeHost>>(), frame = deferred<number>(), preparing = deferred<void>();
    const host = makeHost(), scene = { dispose: vi.fn() };
    boundary.create.mockReturnValue(graphics.promise);
    boundary.load.mockResolvedValue(scene);
    boundary.reveal.mockImplementation(() => { preparing.resolve(); return frame.promise; });

    const startup = app.init();
    await Promise.resolve();
    expect(boundary.load).not.toHaveBeenCalled();
    expect(body.dataset.worldState).toBe("loading");
    graphics.resolve(host);
    await preparing.promise;
    expect(boundary.load).toHaveBeenCalledExactlyOnceWith(host.engine, expect.any(Function));
    expect(loading.remove).not.toHaveBeenCalled();
    expect(interfaceRoot.removeAttribute).not.toHaveBeenCalled();
    expect(canvas.dataset.readyFrame).toBeUndefined();

    frame.resolve(7);
    await startup;
    expect(body.dataset.worldState).toBe("ready");
    expect(canvas.dataset.readyFrame).toBe("7");
    expect(loading.remove).toHaveBeenCalledOnce();
    expect(interfaceRoot.removeAttribute).toHaveBeenCalledWith("inert");
    app.dispose();
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(host.dispose).toHaveBeenCalledOnce();
  });

  it("releases a graphics host that finishes after disposal without loading or revealing a world", async () => {
    const graphics = deferred<ReturnType<typeof makeHost>>(), host = makeHost();
    boundary.create.mockReturnValue(graphics.promise);
    const startup = app.init();
    app.dispose(); app.dispose();
    graphics.resolve(host);
    await startup;

    expect(host.dispose).toHaveBeenCalledOnce();
    expect(boundary.load).not.toHaveBeenCalled();
    expect(boundary.reveal).not.toHaveBeenCalled();
    expect(loading.remove).not.toHaveBeenCalled();
    expect(interfaceRoot.removeAttribute).not.toHaveBeenCalled();
    expect(body.dataset.worldState).toBe("loading");
    await app.init(); // A late lifecycle callback must not reopen a disposed app.
    expect(boundary.create).toHaveBeenCalledOnce();
    expect(host.dispose).toHaveBeenCalledOnce();
  });

  it.each([false, true])("propagates a graphics initialization error safely when already disposed is %s", async alreadyDisposed => {
    const graphics = deferred<ReturnType<typeof makeHost>>(), failure = new Error("WebGPU device request rejected");
    boundary.create.mockReturnValue(graphics.promise);
    const startup = app.init();
    const rejection = expect(startup).rejects.toBe(failure);
    if (alreadyDisposed) app.dispose();
    graphics.reject(failure);
    await rejection;
    // main.ts uses this cleanup before showing the original startup error.
    expect(() => { app.dispose(); app.dispose(); }).not.toThrow();
    expect(boundary.load).not.toHaveBeenCalled();
    expect(boundary.reveal).not.toHaveBeenCalled();
    expect(loading.remove).not.toHaveBeenCalled();
    expect(body.dataset.worldState).toBe("loading");
  });

  it("releases initialized graphics after a scene load failure without revealing a partial world", async () => {
    const host = makeHost(), failure = new Error("World download failed");
    boundary.create.mockResolvedValue(host);
    boundary.load.mockRejectedValue(failure);
    await expect(app.init()).rejects.toBe(failure);
    app.dispose(); app.dispose();
    expect(host.dispose).toHaveBeenCalledOnce();
    expect(boundary.reveal).not.toHaveBeenCalled();
    expect(loading.remove).not.toHaveBeenCalled();
    expect(interfaceRoot.removeAttribute).not.toHaveBeenCalled();
    expect(body.dataset.worldState).toBe("loading");
  });
});
