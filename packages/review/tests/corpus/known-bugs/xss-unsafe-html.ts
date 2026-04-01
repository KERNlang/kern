// BUG: innerHTML assigned directly from user input — XSS vulnerability
export function renderComment(userInput: string): void {
  const div = document.createElement('div');
  div.innerHTML = userInput; // unsanitized user input
  document.body.appendChild(div);
}
