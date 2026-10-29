export { hyperlink };

const OSC_8 = "\u001B]8;;";
const BEL = "\u0007";

// An OSC-8 link opens the full URL even where the terminal or a clack note wraps the line mid-URL.
const hyperlink = (url: string, text: string = url, enabled: boolean = process.stdout.isTTY === true): string =>
  enabled && /^https?:\/\//.test(url) ? `${OSC_8}${url}${BEL}${text}${OSC_8}${BEL}` : text;
