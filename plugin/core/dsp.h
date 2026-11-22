// Web Audio building blocks, written to the Web Audio specification so the plugin
// sounds like the app (which plays through Chromium's Web Audio).
#pragma once
#include <algorithm>
#include <array>
#include <cmath>

namespace bdb {

constexpr double kPi = 3.14159265358979323846;

/**
 * An AudioParam's automation timeline, for the few calls superdough makes:
 * setValueAtTime, linearRampToValueAtTime and exponentialRampToValueAtTime.
 * Fixed size so voices never allocate.
 */
class ParamTimeline {
public:
    enum Kind { Set, Linear, Exponential };
    ParamTimeline(double initial = 0) : initial_(initial) {}
    void reset(double initial) {
        initial_ = initial;
        n_ = 0;
    }
    void setValueAtTime(double v, double t) { add(Set, v, t); }
    void linearRampToValueAtTime(double v, double t) { add(Linear, v, t); }
    void exponentialRampToValueAtTime(double v, double t) { add(Exponential, v, t); }
    bool automated() const { return n_ > 0; }

    /** The value at time t (seconds), as the spec computes it. */
    double valueAt(double t) const {
        double v = initial_, vt = 0;  // value and time of the last event before t
        for (int i = 0; i < n_; i++) {
            const Event& e = ev_[i];
            if (e.time <= t) {
                v = e.value;
                vt = e.time;
                continue;
            }
            // t is before this event: ramps run from the previous event towards it.
            if (e.kind == Linear) {
                const double span = e.time - vt;
                return span <= 0 ? e.value : v + (e.value - v) * (t - vt) / span;
            }
            if (e.kind == Exponential) {
                if (v == 0 || e.value == 0 || (v > 0) != (e.value > 0)) return v;  // spec: hold the previous value
                const double span = e.time - vt;
                return span <= 0 ? e.value : v * std::pow(e.value / v, (t - vt) / span);
            }
            return v;  // a set in the future: hold
        }
        return v;
    }
    /** Time of the last event (after it the value stays). */
    double lastTime() const { return n_ ? ev_[n_ - 1].time : 0; }

private:
    struct Event {
        Kind kind;
        double value, time;
    };
    void add(Kind k, double v, double t) {
        // Events are kept in time order; one at the same time as an earlier one goes after it.
        if (n_ >= static_cast<int>(ev_.size())) return;
        int at = n_;
        while (at > 0 && ev_[at - 1].time > t) at--;
        for (int i = n_; i > at; i--) ev_[i] = ev_[i - 1];
        ev_[at] = {k, v, t};
        n_++;
    }
    double initial_;
    std::array<Event, 12> ev_{};
    int n_ = 0;
};

/** BiquadFilterNode (lowpass, highpass, bandpass) with the spec's coefficient formulas. */
class Biquad {
public:
    enum Type { Lowpass, Highpass, Bandpass };
    void reset() { x1_ = x2_ = y1_ = y2_ = {0, 0}; }
    void set(Type type, double freq, double q, double sampleRate) {
        const double nyquist = sampleRate / 2;
        freq = std::clamp(freq, 0.0, nyquist);
        const double f = freq / nyquist;  // normalised 0..1
        double b0, b1, b2, a0, a1, a2;
        if (type == Lowpass || type == Highpass) {
            // Q in dB for these two (Web Audio spec), Chromium's Biquad::SetLowpassParams.
            if (f >= 1) {
                if (type == Lowpass) return setRaw(1, 0, 0, 1, 0, 0);
                return setRaw(0, 0, 0, 1, 0, 0);
            }
            if (f <= 0) {
                if (type == Lowpass) return setRaw(0, 0, 0, 1, 0, 0);
                return setRaw(1, 0, 0, 1, 0, 0);
            }
            const double w0 = kPi * f;
            const double alpha = std::sin(w0) / (2 * std::pow(10.0, q / 20));
            const double c = std::cos(w0);
            if (type == Lowpass) {
                b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2;
            } else {
                b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2;
            }
            a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
        } else {
            if (f <= 0 || f >= 1) return setRaw(0, 0, 0, 1, 0, 0);
            if (q <= 0) return setRaw(1, 0, 0, 1, 0, 0);
            const double w0 = kPi * f;
            const double alpha = std::sin(w0) / (2 * q);
            const double c = std::cos(w0);
            b0 = alpha, b1 = 0, b2 = -alpha;
            a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
        }
        setRaw(b0, b1, b2, a0, a1, a2);
    }
    float process(float x, int ch) {
        const double y = b0_ * x + b1_ * x1_[ch] + b2_ * x2_[ch] - a1_ * y1_[ch] - a2_ * y2_[ch];
        x2_[ch] = x1_[ch];
        x1_[ch] = x;
        y2_[ch] = y1_[ch];
        y1_[ch] = y;
        return static_cast<float>(y);
    }

private:
    void setRaw(double b0, double b1, double b2, double a0, double a1, double a2) {
        b0_ = b0 / a0, b1_ = b1 / a0, b2_ = b2 / a0, a1_ = a1 / a0, a2_ = a2 / a0;
    }
    double b0_ = 1, b1_ = 0, b2_ = 0, a1_ = 0, a2_ = 0;
    std::array<double, 2> x1_{}, x2_{}, y1_{}, y2_{};
};

/** StereoPannerNode, equal power. `pan` is -1..1. */
inline void stereoPan(float inL, float inR, bool mono, double pan, float& outL, float& outR) {
    pan = std::clamp(pan, -1.0, 1.0);
    if (mono) {
        const double x = (pan + 1) / 2;
        outL = static_cast<float>(inL * std::cos(x * kPi / 2));
        outR = static_cast<float>(inL * std::sin(x * kPi / 2));
        return;
    }
    if (pan <= 0) {
        const double x = pan + 1;
        outL = static_cast<float>(inL + inR * std::cos(x * kPi / 2));
        outR = static_cast<float>(inR * std::sin(x * kPi / 2));
    } else {
        const double x = pan;
        outL = static_cast<float>(inL * std::cos(x * kPi / 2));
        outR = static_cast<float>(inR + inL * std::sin(x * kPi / 2));
    }
}

/** The master chain's safety clipper (master.ts softClipCurve), as a WaveShaper with 4097 points. */
class SoftClipper {
public:
    SoftClipper() {
        const int n = 4097;
        const double knee = 0.891;
        for (int i = 0; i < n; i++) {
            const double x = (static_cast<double>(i) / (n - 1)) * 2 - 1;
            const double a = std::abs(x);
            const double y = a <= knee ? a : knee + (1 - knee) * std::tanh((a - knee) / (1 - knee));
            curve_[i] = static_cast<float>((x > 0) - (x < 0)) * static_cast<float>(y);
        }
    }
    /** WaveShaperNode's curve lookup with linear interpolation (spec). */
    float process(float x) const {
        const int n = 4097;
        const double v = (n - 1) / 2.0 * (x + 1.0);
        if (v <= 0) return curve_[0];
        if (v >= n - 1) return curve_[n - 1];
        const int k = static_cast<int>(v);
        const double f = v - k;
        return static_cast<float>((1 - f) * curve_[k] + f * curve_[k + 1]);
    }

private:
    std::array<float, 4097> curve_{};
};

}  // namespace bdb
