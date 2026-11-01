import { Link } from "react-router-dom";
import { useAuth } from "../../context/auth";
import { useAssistantStatus } from "../../hooks/useAssistantStatus";

export default function Navbar() {
  const { user, logout } = useAuth();
  const { enabled: assistantEnabled } = useAssistantStatus();

  return (
    <nav className="bg-ink-800 border-b border-ink-600 text-chalk px-6 py-3 flex items-center justify-between">
      <Link to="/" className="text-xl font-extrabold tracking-tight">
        Fantasy <span className="text-chalk-dim">Draft</span>
      </Link>
      {user && (
        <div className="flex items-center gap-5">
          <Link to="/" className="text-sm text-chalk-dim hover:text-chalk transition-colors">
            Dashboard
          </Link>
          <Link to="/rankings" className="text-sm text-chalk-dim hover:text-chalk transition-colors">
            Rankings
          </Link>
          <Link to="/analytics" className="text-sm text-chalk-dim hover:text-chalk transition-colors">
            Analytics
          </Link>
          {/* The link stays while the feature is held, with the badge saying
              so. Removing it would leave the page reachable but unadvertised;
              the badge sets the expectation before the click instead. */}
          <Link
            to="/assistant"
            className="flex items-center gap-1.5 text-sm text-chalk-dim hover:text-chalk transition-colors"
          >
            Ask AI
            {assistantEnabled === false && (
              <span className="badge-sm bg-caution/15 text-caution">Soon</span>
            )}
          </Link>
          <span className="text-chalk-mut text-sm">{user.username}</span>
          <button
            onClick={logout}
            className="text-sm bg-ink-700 border border-ink-600 hover:bg-ink-600 text-chalk-dim px-3 py-1 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}
