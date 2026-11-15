import type { SceneStartupProgress } from "../scene/guardSceneStartup";

const phases = ["world", "assets", "graphics", "enter"] as const;
const phaseCopy = {
  world: { title: "Loading world data", pun: "Taking the scenic route, byte by byte." },
  assets: { title: "Loading meshes and textures", pun: "No stone left unrendered." },
  graphics: { title: "Preparing graphics", pun: "Every hero needs a little shade." },
  enter: { title: "Entering the world", pun: "Your knight out is about to begin." },
};

/** The bar describes its current step, not an invented overall ETA. Only stage
 * changes enter the live region; rapidly changing counts stay available to read. */
class LoadingScreen {
  private stage: SceneStartupProgress["stage"] | undefined;
  private failed = false;
  constructor(readonly element: HTMLElement) {}

  show(): void { if (!this.failed) this.element.hidden = false; }
  hide(): void { if (!this.failed) this.element.hidden = true; }

  update(progress: SceneStartupProgress): void {
    if (this.failed) return;
    this.show();
    this.element.dataset.stage = progress.stage;
    const index = phases.indexOf(progress.stage);
    const copy = phaseCopy[progress.stage];
    this.text("loading-detail", progress.detail);
    this.text("loading-step-count", `Step ${index + 1} of ${phases.length}`);
    if (this.stage !== progress.stage) {
      this.stage = progress.stage;
      this.text("loading-stage-status", copy.title);
      this.text("loading-pun", copy.pun);
    }
    for (const [stepIndex, step] of [...this.element.querySelectorAll<HTMLElement>("[data-loading-step]")].entries()) {
      step.dataset.state = stepIndex < index ? "complete" : stepIndex === index ? "current" : "upcoming";
      step.setAttribute("aria-label", `${step.textContent?.trim()}, ${step.dataset.state}`);
      if (stepIndex === index) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    }
    const bar = this.element.querySelector<HTMLElement>("[role=progressbar]");
    if (!bar) return;
    const measurement = progress.measurement;
    const measurable = measurement && Number.isFinite(measurement.completed) && Number.isFinite(measurement.total)
      && measurement.total > 0 && measurement.completed >= 0 && measurement.completed <= measurement.total;
    bar.setAttribute("aria-label", measurable ? measurement.label : copy.title);
    bar.dataset.indeterminate = String(!measurable);
    if (measurable) {
      // Flooring avoids displaying 100% until this measured step actually ends.
      const percentage = Math.floor(measurement.completed / measurement.total * 100);
      bar.setAttribute("aria-valuenow", String(percentage));
      bar.setAttribute("aria-valuetext", `${percentage}% — ${measurement.label.toLowerCase()}`);
      bar.style.setProperty("--loading-progress", `${percentage}%`);
      this.text("loading-measure", `${percentage}% of this step`);
    } else {
      bar.removeAttribute("aria-valuenow");
      bar.setAttribute("aria-valuetext", "In progress; total not yet known");
      bar.style.removeProperty("--loading-progress");
      this.text("loading-measure", "In progress");
    }
  }

  error(error: unknown): void {
    this.failed = true;
    this.element.hidden = false;
    this.element.dataset.state = "error";
    this.element.setAttribute("aria-busy", "false");
    this.text("loading-title", "Unable to enter the world");
    const message = error instanceof Error ? error.message : "Please reload and try again.";
    this.text("loading-error", message);
    for (const node of this.element.querySelectorAll<HTMLElement>("[data-loading-only]")) node.hidden = true;
    const alert = this.element.querySelector<HTMLElement>("#loading-error");
    if (alert) { alert.hidden = false; alert.setAttribute("role", "alert"); }
    const retry = this.element.querySelector<HTMLButtonElement>("#loading-retry");
    if (retry) { retry.hidden = false; retry.onclick = () => window.location.reload(); }
  }

  private text(id: string, text: string): void {
    const node = this.element.querySelector<HTMLElement>(`#${id}`);
    if (node && node.textContent !== text) node.textContent = text;
  }
}

let current: LoadingScreen | undefined;
export function getLoadingScreen(): LoadingScreen | undefined {
  const element = document.getElementById("loading");
  if (!element) return undefined;
  if (current?.element !== element) current = new LoadingScreen(element);
  return current;
}

export function showLoadingError(error: unknown): void {
  const loading = getLoadingScreen();
  if (loading) { loading.error(error); return; }
  // Retain an actionable error even if the host page omitted the loading panel.
  const fallback = document.createElement("section");
  fallback.className = "loading-message";
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = `Unable to enter the world. ${error instanceof Error ? error.message : "Please reload and try again."}`;
  const retry = document.createElement("button");
  retry.className = "loading-retry"; retry.type = "button"; retry.textContent = "Reload and retry";
  retry.onclick = () => window.location.reload();
  fallback.append(message, retry); document.body.append(fallback);
}
