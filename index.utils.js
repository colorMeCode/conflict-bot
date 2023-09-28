function formatLineNumbers(numbers) {
  if (!numbers || numbers.length === 0) return "";

  let formatted = [];
  let start = numbers[0];
  let end = start;

  for (let i = 1; i < numbers.length; i++) {
    // Check if the current number is consecutive to the previous
    if (numbers[i] === end + 1) {
      end = numbers[i];
    } else {
      if (start !== end) {
        formatted.push(`${start}...${end}`);
      } else {
        formatted.push(start.toString());
      }
      start = end = numbers[i];
    }
  }

  // Add the last number or range to the formatted array
  if (start !== end) {
    formatted.push(`${start}...${end}`);
  } else {
    formatted.push(start.toString());
  }

  return formatted.join(", ");
}

module.exports = {
  formatLineNumbers,
};
