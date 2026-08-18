import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleTerminalWebSocket } from './routes/terminal';
import projectsRouter from './routes/projects';
import sessionsRouter from './routes/sessions';
import gitRouter from './routes/git';
import systemRouter from './routes/system';
import geminiRouter from './routes/gemini';
import explainRouter from './routes/explain';
import reviewRouter from './routes/review';
import commitMessageRouter from './routes/commitMessage';
import screenshotsRouter from './routes/screenshots';
import chatRouter from './routes/chat';
import voiceRouter from './routes/voice';
import paneRouter from './routes/pane';
import { handleEventsWebSocket } from './routes/events';
import { claudeEvents } from './services/claudeEvents';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.use('/api/projects', projectsRouter);
app.use('/api/projects/:id/session', sessionsRouter);
app.use('/api/projects/:id/git', gitRouter);
app.use('/api/projects/:id/explain', explainRouter);
app.use('/api/projects/:id/review', reviewRouter);
app.use('/api/projects/:id/commit-message', commitMessageRouter);
app.use('/api/projects/:id/screenshots', screenshotsRouter);
app.use('/api/projects/:id/chat', chatRouter);
app.use('/api/system', systemRouter);
app.use('/api/gemini', geminiRouter);
app.use('/api/pane', paneRouter);
app.use('/api/claude/chat', chatRouter);
app.use('/api/voice', voiceRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req) => {
  const url = req.url || '';

  const match = url.match(/^\/ws\/terminal\/(.+)$/);
  if (match) {
    const sessionId = match[1];
    handleTerminalWebSocket(ws, sessionId);
  } else if (url === '/ws/events') {
    handleEventsWebSocket(ws);
  } else {
    ws.close(4000, 'Unknown WebSocket endpoint');
  }
});

claudeEvents.start();

server.listen(PORT, () => {
  console.log(`AI Platform backend listening on port ${PORT}`);
});
