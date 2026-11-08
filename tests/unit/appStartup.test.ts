import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";

const boundary = vi.hoisted(() => ({ create: vi.fn(), load: vi.fn(), reveal: vi.fn(), error: vi.fn(), openInspector: vi.fn() }));
vi.mock("../../src/engine/EngineHost", () => ({ EngineHost: { create: boundary.create } }));
vi.mock("../../src/scene/loadEnvironment", () => ({ loadEnvironment: boundary.load }));
vi.mock("../../src/scene/prepareSceneForReveal", () => ({ prepareSceneForReveal: boundary.reveal }));
vi.mock("../../src/ui/LoadingScreen", () => ({ showLoadingError: boundary.error }));
vi.mock("../../src/scene/openBabylonInspector", () => ({ openBabylonInspector: boundary.openInspector }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

class Canvas {
  readonly dataset: Record<string, string> = {};
}
const makeHost = () => ({ engine: {}, dispose: vi.fn(), run: vi.fn(), setLoadingStatus: vi.fn() });

describe("application asynchronous graphics startup", () => {
  let app: App, canvas: Canvas;
  let body: { dataset: Record<string, string> };
  let loading: { remove: ReturnType<typeof vi.fn> }, interfaceRoot: { removeAttribute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    boundary.create.mockReset(); boundary.load.mockReset(); boundary.reveal.mockReset(); boundary.error.mockReset(); boundary.openInspector.mockReset();
    canvas = new Canvas(); body = { dataset: { worldState: "loading" } };
    loading = { remove: vi.fn() }; interfaceRoot = { removeAttribute: vi.fn() };
    vi.stubGlobal("HTMLCanvasElement", Canvas);
    vi.stubGlobal("document", {
      body,
      getElementById: (id: string) => id === "canvas" ? canvas : id === "app" ? interfaceRoot : id === "loading" ? loading : null,
    });
    vi.stubGlobal("window", { location: { search: "" } });
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
    await app.init();
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

describe("Babylon Inspector query flag", () => {
  let app: App, canvas: Canvas, body: { dataset: Record<string, string> }, location: { search: string };
  const scene = { dispose: vi.fn() };

  beforeEach(() => {
    boundary.create.mockReset(); boundary.load.mockReset(); boundary.reveal.mockReset(); boundary.openInspector.mockReset();
    canvas = new Canvas(); body = { dataset: { worldState: "loading" } }; location = { search: "" };
    vi.stubGlobal("HTMLCanvasElement", Canvas);
    vi.stubGlobal("document", { body, getElementById: (id: string) => id === "canvas" ? canvas : null });
    vi.stubGlobal("window", { location });
    boundary.create.mockResolvedValue(makeHost());
    boundary.load.mockResolvedValue(scene);
    boundary.reveal.mockResolvedValue(3);
    app = new App();
  });
  afterEach(() => { app.dispose(); vi.unstubAllGlobals(); });

  it("opens the Inspector once on the revealed scene when inspect equals 1", async () => {
    location.search = "?inspect=1";
    const worldStateWhenOpened: string[] = [];
    boundary.openInspector.mockImplementation(async () => { worldStateWhenOpened.push(body.dataset.worldState!); return vi.fn(); });
    await app.init();
    expect(boundary.openInspector).toHaveBeenCalledExactlyOnceWith(scene);
    expect(worldStateWhenOpened).toEqual(["ready"]);
  });

  it.each(["", "?inspect=0", "?inspect=true", "?world=interlude"])("does not open the Inspector for the query %j", async search => {
    location.search = search;
    await app.init();
    expect(boundary.openInspector).not.toHaveBeenCalled();
    expect(body.dataset.worldState).toBe("ready");
  });

  it("closes the opened Inspector when the app is disposed", async () => {
    location.search = "?inspect=1";
    const closeInspector = vi.fn().mockResolvedValue(undefined);
    boundary.openInspector.mockResolvedValue(closeInspector);
    await app.init();
    expect(closeInspector).not.toHaveBeenCalled();
    app.dispose(); app.dispose();
    expect(closeInspector).toHaveBeenCalledOnce();
  });

  it("closes an Inspector that finishes opening after the app was disposed", async () => {
    location.search = "?inspect=1";
    const closeInspector = vi.fn().mockResolvedValue(undefined);
    let finishOpening!: (close: typeof closeInspector) => void;
    boundary.openInspector.mockReturnValue(new Promise(resolve => { finishOpening = resolve; }));
    const startup = app.init();
    await vi.waitFor(() => expect(boundary.openInspector).toHaveBeenCalledOnce());
    app.dispose();
    finishOpening(closeInspector);
    await startup;
    expect(closeInspector).toHaveBeenCalledOnce();
  });
});
