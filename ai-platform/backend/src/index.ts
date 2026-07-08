import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleTerminalWebSocket } from './routes/terminal';
import projectsRouter from './routes/projects';
import sessionsRouter from './routes/sessions';
import gitRouter from './routes/git';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.use('/api/projects', projectsRouter);
app.use('/api/projects/:id/session', sessionsRouter);
app.use('/api/projects/:id/git', gitRouter);

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
  } else {
    ws.close(4000, 'Unknown WebSocket endpoint');
  }
});

server.listen(PORT, () => {
  console.log(`AI Platform backend listening on port ${PORT}`);
});
