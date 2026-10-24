import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/inter/400.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/800.css";
import "@fontsource/lalezar/400.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/700-italic.css";
import "@fontsource/roboto-mono/400.css";
import "./styles.css";
import "./desktop";

createRoot(document.getElementById("root")!).render(<App />);

// handy for debugging from the devtools console
if (import.meta.env.DEV) import("./store").then(({ useStore }) => ((window as unknown as { nomad: unknown }).nomad = useStore));
