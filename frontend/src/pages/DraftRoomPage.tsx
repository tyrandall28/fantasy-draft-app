import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DraftProvider } from "../context/DraftContext";
import { useDraft } from "../context/draft";
import { useAuth } from "../context/auth";
import DraftBoard from "../components/draft/DraftBoard";
import AvailablePlayerList from "../components/draft/AvailablePlayerList";
import TeamRosterPanel from "../components/draft/TeamRosterPanel";
import PickTimer from "../components/draft/PickTimer";
import CurrentPickBanner from "../components/draft/CurrentPickBanner";
import BottomPanel from "../components/draft/BottomPanel";

function DraftRoomContent() {
  const { state, connected, makePick, toggleTimer, undoPick, draftedPlayerIds } = useDraft();
  const { user } = useAuth();
  const [showSettings, setShowSettings] = useState(false);

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-ink-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto mb-3" />
          <p className="text-chalk-dim">Connecting to draft room...</p>
        </div>
      </div>
    );
  }

  const isMyTurn = state.current_user_id === user?.id;
  const isCompleted = state.status === "completed";
  // Undo and the timer toggle are commissioner-only and enforced in
  // app/ws/draft_room.py. Hidden here so nobody is offered a button whose only
  // possible outcome is an error.
  const isCommissioner = state.commissioner_id === user?.id;

  return (
    <div className="h-screen bg-ink-900 text-chalk flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="bg-ink-800 border-b border-ink-700 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-chalk-dim hover:text-chalk-dim transition-colors"
            title="Back to Dashboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
          </Link>
          {isCompleted ? (
            <h1 className="text-lg font-bold text-chalk">Draft Complete!</h1>
          ) : (
            <CurrentPickBanner state={state} isMyTurn={isMyTurn} />
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isCompleted && state.timer_enabled && (
            <PickTimer seconds={state.seconds_remaining} isMyTurn={isMyTurn} />
          )}
          {!isCompleted && !state.timer_enabled && (
            <span className="text-xs px-3 py-1.5 rounded-lg bg-caution/15 text-caution font-medium">
              Offline Mode
            </span>
          )}
          {/* Undo last pick — commissioner only */}
          {isCommissioner && state.picks.length > 0 && (
            <button
              onClick={undoPick}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-fall/15 text-fall hover:bg-fall/25 transition-colors font-medium"
              title="Undo last pick — returns player to available pool"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Undo Pick
            </button>
          )}

          <span className={`text-xs px-2 py-1 rounded ${connected ? "bg-rise/20 text-rise" : "bg-fall/20 text-fall"}`}>
            {connected ? "Connected" : "Reconnecting..."}
          </span>

          {/* Settings */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 rounded hover:bg-ink-600 transition-colors text-chalk-dim hover:text-chalk-dim"
              title="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>

            {showSettings && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowSettings(false)} />
                <div className="absolute right-0 top-full mt-2 w-64 panel-float z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-ink-700">
                    <h4 className="text-sm font-semibold text-chalk-dim">Draft Settings</h4>
                  </div>
                  <div className="p-4 space-y-4">
                    {/* Timer toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-chalk-dim">Pick Timer</p>
                        <p className="text-[10px] text-chalk-mut">Auto-pick when timer expires</p>
                      </div>
                      {/* Read-only for everyone but the commissioner: the
                          clock is league-wide, so the toggle shows its state
                          to all but only he can move it. */}
                      <button
                        onClick={() => toggleTimer(!state.timer_enabled)}
                        disabled={!isCommissioner}
                        title={isCommissioner ? undefined : "Only the commissioner can change this"}
                        className={`relative w-10 h-5 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          state.timer_enabled ? "bg-accent" : "bg-ink-600"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-chalk transition-transform ${
                            state.timer_enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

                    <div className="text-[10px] text-chalk-mut pt-2 border-t border-ink-700">
                      {state.timer_enabled
                        ? "Timer is active. Picks will auto-select when time runs out."
                        : "Offline mode. Take your time — no auto-picks."}
                      {!isCommissioner && " Only the commissioner can change this."}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top: 3-column board area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Available Players */}
          {!isCompleted && (
            <div className="w-72 flex-shrink-0 border-r border-ink-700 overflow-hidden">
              <AvailablePlayerList
                draftedPlayerIds={draftedPlayerIds}
                onPick={makePick}
                canPick={true}
              />
            </div>
          )}

          {/* Center: Draft Board — takes all remaining space */}
          <div className="flex-1 overflow-hidden p-3">
            <DraftBoard state={state} userId={user?.id} />
          </div>

          {/* Right: My Roster */}
          <div className="w-64 flex-shrink-0 border-l border-ink-700 overflow-hidden">
            <TeamRosterPanel state={state} userId={user?.id} />
          </div>
        </div>

        {/* Bottom: Tabbed panel */}
        <BottomPanel picks={state.picks} />
      </div>
    </div>
  );
}

export default function DraftRoomPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <DraftProvider leagueId={id}>
      <DraftRoomContent />
    </DraftProvider>
  );
}
