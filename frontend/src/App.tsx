import { useState } from 'react';
import Lobby from './pages/Lobby';
import Game from './pages/Game';

export interface JoinInfo {
  sessionId: string;
  playerName: string;
}

export default function App() {
  const [join, setJoin] = useState<JoinInfo | null>(null);

  if (!join) return <Lobby onJoin={setJoin} />;
  return <Game key={join.sessionId} sessionId={join.sessionId} playerName={join.playerName} onExit={() => setJoin(null)} />;
}
