function formatDate(value, format = "yyyy-MM-dd") {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const monthsShort = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  const monthsLong = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];

  const tokens = {
    yyyy: () => String(date.getFullYear()),
    MM: () => String(date.getMonth() + 1).padStart(2, "0"),
    MMM: () => monthsShort[date.getMonth()],
    MMMM: () => monthsLong[date.getMonth()],
    dd: () => String(date.getDate()).padStart(2, "0"),
    d: () => String(date.getDate())
  };

  return format.replace(/MMMM|MMM|yyyy|MM|dd|d/g, (token) => {
    const resolver = tokens[token];
    return resolver ? resolver() : token;
  });
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addFilter("date", formatDate);
  eleventyConfig.addFilter("head", (array, count = 1) => {
    if (!Array.isArray(array) || count === 0) {
      return [];
    }

    const cloned = Array.from(array);

    if (count > 0) {
      return cloned.slice(0, count);
    }

    return cloned.slice(count);
  });

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/photo": "photo" });

  eleventyConfig.addWatchTarget("src/assets/css/styles.css");
  eleventyConfig.addWatchTarget("src/assets/js/main.js");

  eleventyConfig.addCollection("enPosts", (collection) => {
    return collection
      .getFilteredByGlob("src/en/blog/posts/**/*.{md,njk}")
      .filter((item) => !item.data.draft)
      .sort((a, b) => b.date - a.date);
  });

  eleventyConfig.addCollection("jaPosts", (collection) => {
    return collection
      .getFilteredByGlob("src/ja/blog/posts/**/*.{md,njk}")
      .filter((item) => !item.data.draft)
      .sort((a, b) => b.date - a.date);
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"]
  };
};
