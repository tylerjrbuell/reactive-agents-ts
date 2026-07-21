export function isPalindrome(s: string): boolean {
  // Remove non-alphanumeric characters and convert to lowercase
  const cleaned = s.replace(/[^a-z0-9]/gi, '').toLowerCase();
  
  // Check if cleaned string equals its reverse
  return cleaned === cleaned.split('').reverse().join('');
}
