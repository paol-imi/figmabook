/** CSS modules: create-figma-plugin and Vite both expose the class map as the default export. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
