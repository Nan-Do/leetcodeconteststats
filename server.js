import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const logger = (req, res, next) => {
  const start = Date.now();
  const { method, url } = req;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const browser = req.get('User-Agent') || 'Unknown Browser';

  // Listen for the 'finish' event to log after the response is sent
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    console.log(`[${new Date().toISOString()}] ${ip} ${browser} ${method} ${url} ${statusCode} - ${duration}ms`);
  });

  next();
};

export default logger;

app.use(logger);
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));
app.use('/api', apiRouter);

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
