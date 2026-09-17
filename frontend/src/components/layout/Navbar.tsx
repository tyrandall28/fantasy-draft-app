import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="bg-ink-800 border-b border-ink-600 text-chalk px-6 py-3 flex items-center justify-between">
      <Link to="/" className="text-xl font-extrabold tracking-tight">
        Fantasy <span className="text-chalk-dim">Draft</span>
      </Link>
      {user && (
        <div className="flex items-center gap-5">
          <Link to="/" className="text-sm text-slate-300 hover:text-white transition-colors">
            Dashboard
          </Link>
          <Link to="/rankings" className="text-sm text-slate-300 hover:text-white transition-colors">
            Rankings
          </Link>
          <Link to="/analytics" className="text-sm text-slate-300 hover:text-white transition-colors">
            Analytics
          </Link>
          <Link to="/assistant" className="text-sm text-slate-300 hover:text-white transition-colors">
            Ask AI
          </Link>
          <span className="text-slate-500 text-sm">{user.username}</span>
          <button
            onClick={logout}
            className="text-sm bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 px-3 py-1 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}
