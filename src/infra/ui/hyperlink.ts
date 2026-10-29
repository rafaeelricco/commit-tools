export { hyperlink, hyperlinksEnabled };

const OSC_8 = "\u001B]8;;";
const BEL = "\u0007";

const hyperlinksEnabled = (): boolean => process.stdout.isTTY === true;

// An OSC-8 link opens the full URL even where the terminal or a clack note wraps the line mid-URL.
const hyperlink = (url: string, text: string = url, enabled: boolean = hyperlinksEnabled()): string =>
  enabled && /^https?:\/\//.test(url) ? `${OSC_8}${url}${BEL}${text}${OSC_8}${BEL}` : text;
