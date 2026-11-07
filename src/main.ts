// Native Vanilla template entry, adapted from Babylon.js Editor (Apache-2.0).
import "./style.css";
import { App } from "./App";
import { showLoadingError } from "./ui/LoadingScreen";

const app = new App();
void app.init().catch((error: unknown) => {
  app.dispose();
  showLoadingError(error);
});
const handlePageHide = (event: PageTransitionEvent): void => {
  if (!event.persisted) app.dispose();
};
window.addEventListener("pagehide", handlePageHide);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener("pagehide", handlePageHide);
  app.dispose();
});
