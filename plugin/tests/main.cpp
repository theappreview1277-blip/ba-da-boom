#include "test.h"

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);  // nothing is lost if a test crashes
    int failedCases = 0;
    for (auto& c : bdbtest::cases()) {
        const int before = bdbtest::failures();
        try {
            c.fn();
        } catch (const std::exception& e) {
            bdbtest::check(false, "threw", e.what());
        }
        const bool ok = bdbtest::failures() == before;
        if (!ok) failedCases++;
        std::printf("  %s  %s\n", ok ? "PASS" : "FAIL", c.name.c_str());
    }
    std::printf("%d of %zu passed\n", static_cast<int>(bdbtest::cases().size()) - failedCases, bdbtest::cases().size());
    return failedCases == 0 ? 0 : 1;
}
