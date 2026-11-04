// Native Vanilla template entry, adapted from Babylon.js Editor (Apache-2.0).
import "./style.css";
import { App } from "./App";

const app = new App();
void app.init().catch((error: unknown) => {
  app.dispose();
  const loading = document.getElementById("loading") ?? document.body.appendChild(document.createElement("p"));
  loading.className = "loading-message";
  loading.hidden = false;
  loading.textContent = `Unable to enter the world. ${error instanceof Error ? error.message : "Please reload and try again."}`;
  loading.setAttribute("role", "alert");
});
const handlePageHide = (event: PageTransitionEvent): void => {
  if (!event.persisted) app.dispose();
};
window.addEventListener("pagehide", handlePageHide);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener("pagehide", handlePageHide);
  app.dispose();
});
