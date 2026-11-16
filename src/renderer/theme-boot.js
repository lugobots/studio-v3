(function () {
  try {
    var theme = localStorage.getItem("studio-v3-appearance");
    if (theme !== "light") {
      theme = "dark";
    }
    document.documentElement.setAttribute("data-palette", "default");
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    /* keep dark defaults from html attributes */
  }
})();
