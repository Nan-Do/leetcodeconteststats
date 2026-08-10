import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy the real client address arrives in X-Forwarded-For,
// and without this the rate limiter buckets every visitor under the proxy's own
// address. Off by default, because trusting a header that nothing sets lets a
// client claim any address it likes. Set to the number of proxies in front.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

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

// Search runs a DISTINCT over 12M rows and fires once per keystroke, so it is
// the endpoint worth putting a ceiling on. 300/minute is far above what typing
// a username costs (the client debounces to at most 4/second) and well below
// what a script can spend.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
  },
});

app.disable('x-powered-by');
app.use(logger);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // ApexCharts and Alpine come from jsDelivr. Alpine compiles its x-
      // attributes with the Function constructor, which is what needs
      // 'unsafe-eval', and index.html sets the theme from an inline script
      // before first paint so the page doesn't flash. Both of those can go once
      // the two libraries are vendored locally and Alpine's CSP build is used.
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-inline'", "'unsafe-eval'"],
      // x-show writes style="display:none", and the chart tooltip is built as
      // an inline-styled string.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      // The real value of this policy: an injected script still cannot phone
      // home, embed a plugin, or frame the page.
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));
app.use(compression());
app.use(express.json());
app.use(express.static(join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders(res, filePath) {
    // The entry point names the asset files, so caching it for an hour would
    // hide a deploy for an hour. It revalidates against its ETag instead, which
    // costs one 304.
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use('/api', apiLimiter, apiRouter);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
