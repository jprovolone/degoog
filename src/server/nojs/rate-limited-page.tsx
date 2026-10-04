export const RateLimitedPage = ({ message }: { message: string }): JSX.Element => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>429</title>
    </head>
    <body>
      <p>{message}</p>
    </body>
  </html>
);
