// A very small test runner: CHECK(cond, message) records failures; main prints PASS/FAIL lines
// in the same style as the app's end-to-end tests.
#pragma once
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace bdbtest {
struct Case {
    std::string name;
    std::function<void()> fn;
};
inline std::vector<Case>& cases() {
    static std::vector<Case> c;
    return c;
}
inline int& failures() {
    static int f = 0;
    return f;
}
inline std::string& current() {
    static std::string s;
    return s;
}
struct Register {
    Register(const char* n, std::function<void()> f) { cases().push_back({n, std::move(f)}); }
};
inline void check(bool ok, const std::string& what, const std::string& detail = {}) {
    if (ok) return;
    failures()++;
    std::printf("    failed: %s%s%s\n", what.c_str(), detail.empty() ? "" : "  ", detail.c_str());
}
}  // namespace bdbtest

#define BDB_CAT2(a, b) a##b
#define BDB_CAT(a, b) BDB_CAT2(a, b)
#define TEST(name) \
    static void BDB_CAT(test_, __LINE__)(); \
    static bdbtest::Register BDB_CAT(reg_, __LINE__)(name, BDB_CAT(test_, __LINE__)); \
    static void BDB_CAT(test_, __LINE__)()
#define CHECK(cond, ...) bdbtest::check(static_cast<bool>(cond), #cond, ##__VA_ARGS__)
