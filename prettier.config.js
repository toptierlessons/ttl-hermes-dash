/** @type {import("prettier").Config} */
export default {
  // Sorts Tailwind class lists for consistent, readable className strings.
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./src/index.css",
};
