/** Render the simulation page as an HTML string. */
export function renderPage(): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Island Survival Simulation</title>
    </head>
    <body>
      <h1>Island Survival Simulation</h1>
      <div id="island"></div>
    </body>
    </html>
  `;
}