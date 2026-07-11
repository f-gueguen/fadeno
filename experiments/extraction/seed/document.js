const button = document.querySelector("#increment");
button.addEventListener("click", async () => {
  const module = await import("/handler.js");
  module.increment(document.querySelector("#value"));
});
