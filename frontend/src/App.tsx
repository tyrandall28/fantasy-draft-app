import { Route, Routes } from "react-router-dom";
import Navbar from "./components/layout/Navbar";
import ProtectedRoute from "./components/layout/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import RankingsPage from "./pages/RankingsPage";
import LobbyPage from "./pages/LobbyPage";
import DraftRoomPage from "./pages/DraftRoomPage";
import DraftResultsPage from "./pages/DraftResultsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import AssistantPage from "./pages/AssistantPage";

/** Standard pages get navbar + gray background */
function DefaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0f1117]">
      <Navbar />
      {children}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <DefaultLayout>
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          </DefaultLayout>
        }
      />
      <Route
        path="/rankings"
        element={
          <DefaultLayout>
            <ProtectedRoute>
              <RankingsPage />
            </ProtectedRoute>
          </DefaultLayout>
        }
      />
      <Route
        path="/analytics"
        element={
          <DefaultLayout>
            <ProtectedRoute>
              <AnalyticsPage />
            </ProtectedRoute>
          </DefaultLayout>
        }
      />
      <Route
        path="/assistant"
        element={
          <DefaultLayout>
            <ProtectedRoute>
              <AssistantPage />
            </ProtectedRoute>
          </DefaultLayout>
        }
      />
      {/* Full-screen dark pages — no navbar */}
      <Route
        path="/leagues/:id"
        element={
          <ProtectedRoute>
            <LobbyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/draft/:id"
        element={
          <ProtectedRoute>
            <DraftRoomPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/draft/:id/results"
        element={
          <DefaultLayout>
            <ProtectedRoute>
              <DraftResultsPage />
            </ProtectedRoute>
          </DefaultLayout>
        }
      />
    </Routes>
  );
}
