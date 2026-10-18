// Seed content for a fresh database. Questions reference rounds by `seq`.

export const rounds = [
  { seq: 1, title: 'Quiz Battle', type: 'quiz', duration_min: 15, qualify_count: 20,
    about: 'Multiple choice questions on programming and CS fundamentals. One submission.' },
  { seq: 2, title: 'Coding Battle', type: 'code', duration_min: 45, qualify_count: 10,
    about: 'Solve problems from scratch. Every hidden test you pass earns points.' },
  { seq: 3, title: 'Debugging Battle', type: 'code', duration_min: 30, qualify_count: 5,
    about: 'Each program ships with bugs. Find them, fix them, pass the tests.' },
  { seq: 4, title: 'Final Battle', type: 'code', duration_min: 60, qualify_count: null,
    about: 'Advanced algorithmic problems for the finalists. Highest total wins.' },
];

const template = {
  python: '# Read from stdin, print the answer to stdout\nimport sys\n\ndata = sys.stdin.read().split()\n',
  javascript: "// Read from stdin, print the answer to stdout\nconst data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);\n",
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        \n    }\n}\n',
};

const t = (input, output, hidden = true) => ({ input, output, hidden });

const mcq = (title, options, answer) => ({ round: 1, title, body: '', points: 10, options, answer });

export const questions = [
  mcq('What is the time complexity of binary search on a sorted array of n elements?', ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 1),
  mcq('Which data structure follows Last In, First Out (LIFO) order?', ['Queue', 'Stack', 'Heap', 'Linked list'], 1),
  mcq('In Python, what does len([1, [2, 3], 4]) return?', ['4', '3', '2', 'It raises an error'], 1),
  mcq('Which HTTP status code means "Not Found"?', ['200', '301', '404', '500'], 2),
  mcq('Which SQL clause filters rows after GROUP BY?', ['WHERE', 'HAVING', 'ORDER BY', 'LIMIT'], 1),
  mcq('What does typeof null return in JavaScript?', ['"null"', '"object"', '"undefined"', '"number"'], 1),
  mcq('Which sorting algorithm has the best worst-case time complexity?', ['Quick sort', 'Bubble sort', 'Merge sort', 'Insertion sort'], 2),
  mcq('What does git clone do?', ['Creates a new branch', 'Copies a remote repository to your machine', 'Deletes the repository', 'Merges two branches'], 1),
  mcq('How many edges does a tree with 10 nodes have?', ['10', '9', '11', '20'], 1),
  mcq('Which of these is NOT a primitive type in Java?', ['int', 'boolean', 'String', 'char'], 2),

  { round: 2, title: 'Sum of Digits', points: 100, starter: template,
    body: 'Read a non-negative integer `n` (0 <= n <= 10^18) and print the sum of its digits.\n\nExample: for `12345` print `15`.',
    tests: [t('12345', '15', false), t('0', '0', false), t('999999999999999999', '162'), t('1000000', '1'), t('907', '16')] },
  { round: 2, title: 'Palindrome Check', points: 100, starter: template,
    body: 'Read a single word `s` of lowercase letters (1 <= length <= 10^5). Print `YES` if it reads the same backwards, otherwise `NO`.',
    tests: [t('racecar', 'YES', false), t('battle', 'NO', false), t('a', 'YES'), t('abba', 'YES'), t('abca', 'NO')] },
  { round: 2, title: 'Second Largest', points: 100, starter: template,
    body: 'The first line has `n` (1 <= n <= 10^5). The second line has `n` integers.\n\nPrint the second largest distinct value, or `-1` if it does not exist.',
    tests: [t('5\n4 1 9 7 9', '7', false), t('3\n5 5 5', '-1', false), t('2\n-3 -1', '-3'), t('6\n10 20 30 40 50 60', '50'), t('1\n42', '-1')] },

  { round: 3, title: 'Fix the Factorial', points: 50,
    body: 'Read `n` (0 <= n <= 15) and print `n!`. The starter program has a bug. Fix it.',
    starter: {
      python: 'n = int(input())\nresult = 1\nfor i in range(1, n):\n    result *= i\nprint(result)\n',
      javascript: "const n = Number(require('fs').readFileSync(0, 'utf8'));\nlet result = 1;\nfor (let i = 1; i < n; i++) {\n  result *= i;\n}\nconsole.log(result);\n",
    },
    tests: [t('5', '120', false), t('0', '1', false), t('1', '1'), t('12', '479001600'), t('15', '1307674368000')] },
  { round: 3, title: 'Fix the Vowel Counter', points: 50,
    body: 'Read one line of text and print how many vowels (a, e, i, o, u) it contains, ignoring case. The starter program has a bug. Fix it.',
    starter: {
      python: 's = input()\ncount = 0\nfor ch in s:\n    if ch in "aeiou":\n        count += 1\nprint(count)\n',
      javascript: "const s = require('fs').readFileSync(0, 'utf8');\nlet count = 0;\nfor (const ch of s) {\n  if ('aeiou'.includes(ch)) count++;\n}\nconsole.log(count);\n",
    },
    tests: [t('Hello World', '3', false), t('xyz', '0', false), t('AEIOU', '5'), t('Code Battle', '4'), t('Programming Is Fun', '5')] },
  { round: 3, title: 'Fix the Word Reverser', points: 50,
    body: 'Read one line and print its words in reverse order, separated by single spaces. Extra spaces in the input must not produce empty words. The starter program has bugs. Fix them.',
    starter: {
      python: 's = input()\nwords = s.split(" ")\nwords.reverse\nprint(" ".join(words))\n',
      javascript: "const s = require('fs').readFileSync(0, 'utf8');\nconst words = s.split(' ');\nwords.reverse;\nconsole.log(words.join(' '));\n",
    },
    tests: [t('code battle arena', 'arena battle code', false), t('hello', 'hello', false), t('a b c d', 'd c b a'), t('  lots   of   space  ', 'space of lots'), t('one two', 'two one')] },

  { round: 4, title: 'Longest Increasing Subsequence', points: 200, starter: template,
    body: 'The first line has `n` (1 <= n <= 10^5). The second line has `n` integers.\n\nPrint the length of the longest strictly increasing subsequence. An O(n log n) solution is needed for the largest tests.',
    tests: [t('8\n10 9 2 5 3 7 101 18', '4', false), t('5\n5 4 3 2 1', '1', false), t('1\n7', '1'), t('6\n1 2 3 4 5 6', '6'), t('9\n3 1 4 1 5 9 2 6 5', '4')] },
  { round: 4, title: 'Grid Paths with Walls', points: 200, starter: template,
    body: 'The first line has `r c` (1 <= r, c <= 1000). The next `r` lines describe the grid using `.` for open cells and `#` for walls.\n\nCount the paths from the top-left to the bottom-right cell moving only right or down. Print the count modulo 1000000007, or `0` if no path exists.',
    tests: [t('3 3\n...\n...\n...', '6', false), t('3 3\n...\n.#.\n...', '2', false), t('1 1\n.', '1'), t('2 2\n.#\n#.', '0'), t('3 4\n....\n.#..\n....', '4')] },
];
