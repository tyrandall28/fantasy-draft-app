import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { PlayerCardProvider } from "./context/PlayerCardContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PlayerCardProvider>
          <App />
        </PlayerCardProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
