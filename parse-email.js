import atob from 'atob';

export const parseEmail = (rawMailBody) => {
  // Function to decode base64
  function decodeBase64(base64) {
    return decodeURIComponent(escape(atob(base64)));
  }

  const plainTextRegex = /Content-Type: text\/plain; charset=utf-8\s+Content-Transfer-Encoding: base64\s+([\s\S]+?)\s+--/;
  const htmlTextRegex = /Content-Type: text\/html; charset=utf-8\s+Content-Transfer-Encoding: base64\s+([\s\S]+?)\s+--/;

  const plainTextMatch = rawMailBody.match(plainTextRegex);
  const htmlTextMatch = rawMailBody.match(htmlTextRegex);

  let plainText = "";
  let htmlText = "";

  if (plainTextMatch) {
    plainText = decodeBase64(plainTextMatch[1].trim());
  }
  if (htmlTextMatch) {
    htmlText = decodeBase64(htmlTextMatch[1].trim());
  }

  return {
    plainText: plainText,
    htmlText: htmlText,
  };
}
