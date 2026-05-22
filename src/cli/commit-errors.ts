export { isNonFastForwardError };

const isNonFastForwardError = (error: Error): boolean => {
  const msg = error.message.toLowerCase();
  return msg.includes("non-fast-forward") || msg.includes("updates were rejected");
};
