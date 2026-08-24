import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0');
  await page.goto('https://leetcode.com/problemset/', {waitUntil: 'domcontentloaded'});
  
  const tags = await page.evaluate(async () => {
    const query = `
      query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
        problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
          questions: data {
            titleSlug
            topicTags { name }
          }
        }
      }
    `;
    const res = await fetch("https://leetcode.com/graphql/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { categorySlug: "", limit: 10, skip: 0, filters: {} }
      })
    });
    return await res.json();
  });

  console.log('GRAPHQL TAGS:', JSON.stringify(tags).substring(0, 500));
  await browser.close();
})();
