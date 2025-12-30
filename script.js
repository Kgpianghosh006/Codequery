const form = document.getElementById("search-form");
const input = document.getElementById("query-input");
const resultsDiv = document.getElementById("results");
const spinner = document.getElementById("spinner");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const query = input.value.trim();
  if (!query) return;

  resultsDiv.innerHTML = "";
  spinner.classList.remove("hidden");

  try {
    const res = await fetch("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      spinner.classList.add("hidden");
      resultsDiv.innerHTML = `<p>${(body && body.error) || 'Index building — try again shortly.'}</p>`;
      return;
    }

    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const { results } = await res.json();

    spinner.classList.add("hidden");

    if (results.length === 0) {
      resultsDiv.innerHTML = "<p>No matches found.</p>";
      return;
    }

    resultsDiv.innerHTML = results
      .map((r, i) => {
      const logoPath = `assets/logos/${r.platform ? r.platform.toLowerCase() : 'codeforces'}.png`;
      const desc = r.description ? (r.description.length > 300 ? r.description.slice(0, 300) + '...' : r.description) : '';
      const tags = (r.tags || []).slice(0,5).map(t => `<span class="tag">${t}</span>`).join(' ');

      return `
        <div class="card${i === 0 ? " featured" : ""}">
          <div class="card-header">
            <img src="${logoPath}"
              onerror="this.onerror=null;this.src='assets/logos/codeforces.png'"
              alt="${r.platform} logo"
              class="platform-logo"/>
            <a href="${r.url}" target="_blank" class="card-title">[${r.platform}] ${r.title}</a>
          </div>
          <div class="card-body">
            <p class="desc">${desc}</p>
            <div class="tags">${tags}</div>
          </div>
        </div>
      `;
      })
      .join("");
  } catch (err) {
    spinner.classList.add("hidden");
    console.error(err);
    resultsDiv.innerHTML = `<p>Error: ${err.message}</p>`;
  }
});