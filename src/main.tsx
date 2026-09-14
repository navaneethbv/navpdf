import { createRoot } from "react-dom/client";
import { preparePlatform } from "./services/platform";
import { installModalFocus } from "./components/ModalFocus";
import "./styles.css";
await preparePlatform();
installModalFocus();
const { default: App } = await import("./app/App");
createRoot(document.getElementById("root")!).render(<App />);
