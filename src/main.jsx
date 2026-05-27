import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Single dynamic route — App reads section + subsection from useParams */}
        <Route path="/" element={<App />} />
        <Route path="/:section" element={<App />} />
        <Route path="/:section/:subsection" element={<App />} />
        {/* Catch-all → render App; App will fall back to home for unknown sections */}
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
