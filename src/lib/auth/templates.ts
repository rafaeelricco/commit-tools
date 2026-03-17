export { COMMON_STYLE, SUCCESS_HTML, ERROR_HTML };

const COMMON_STYLE = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --border: 240 5.9% 90%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --success: 142.1 76.2% 36.3%;
    --destructive: 0 84.2% 60.2%;
    --radius: 0.75rem;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: 240 10% 3.9%;
      --foreground: 0 0% 98%;
      --card: 240 10% 3.9%;
      --card-foreground: 0 0% 98%;
      --border: 240 3.7% 15.9%;
      --muted: 240 3.7% 15.9%;
      --muted-foreground: 240 5% 64.9%;
      --success: 142.1 70% 45%;
      --destructive: 0 62.8% 30.6%;
    }
  }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    margin: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .card {
    background-color: hsl(var(--card));
    color: hsl(var(--card-foreground));
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
    padding: 2.5rem 2rem;
    max-width: 28rem;
    width: 100%;
    text-align: center;
    box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
    animation: fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes fade-in-up {
    from { opacity: 0; transform: translateY(16px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .icon { width: 48px; height: 48px; margin: 0 auto 1.5rem; stroke-width: 1.5; }
  .icon-success { color: hsl(var(--success)); }
  .icon-error { color: hsl(var(--destructive)); }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; letter-spacing: -0.025em; }
  p { font-size: 0.875rem; color: hsl(var(--muted-foreground)); margin: 0; line-height: 1.5; }
</style>
`;

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Successful</title>
  ${COMMON_STYLE}
</head>
<body>
  <div class="card">
    <svg class="icon icon-success" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <h1>Authentication Successful</h1>
    <p>You have successfully connected your account. You can now close this tab and return to your terminal.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = (message: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Failed</title>
  ${COMMON_STYLE}
</head>
<body>
  <div class="card">
    <svg class="icon icon-error" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
    <h1>Authentication Failed</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
