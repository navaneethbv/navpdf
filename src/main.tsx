import { createRoot } from "react-dom/client";
import { preparePlatform } from "./services/platform";
import "./styles.css";
await preparePlatform();
const { default: App } = await import("./app/App");
createRoot(document.getElementById("root")!).render(<App />);
