namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// eMAAP photo gates. Serial plate and standard-weight slots accept alias keys
/// and Firebase storage paths (UI shows path-only images; worker used to ignore them).
/// F2 test weight (scale) and F2 corner (rear) satisfy the weights slot.
/// </summary>
public static class VerificationWeightPhotoResolver
{
    public readonly record struct Slot(string Url, string Path, string Name, string ContentType)
    {
        public bool HasEvidence =>
            !string.IsNullOrWhiteSpace(Url) || !string.IsNullOrWhiteSpace(Path);

        public static Slot FromUrl(string url, string name = "n", string contentType = "image/jpeg") =>
            new(url, string.Empty, name, contentType);
    }

    public static bool HasUrl(Slot slot) => slot.HasEvidence;

    public static bool LooksLikeHttp(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && (value.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("https://", StringComparison.OrdinalIgnoreCase));

    public static string FirstNonEmptyUrl(params string?[] urls)
    {
        foreach (var url in urls)
        {
            if (!string.IsNullOrWhiteSpace(url))
            {
                return url.Trim();
            }
        }

        return string.Empty;
    }

    public static Slot Normalize(string? url, string? path, string name, string contentType)
    {
        var trimmedUrl = url?.Trim() ?? string.Empty;
        var trimmedPath = path?.Trim() ?? string.Empty;
        if (!LooksLikeHttp(trimmedUrl) && trimmedUrl.Contains('/', StringComparison.Ordinal))
        {
            if (string.IsNullOrWhiteSpace(trimmedPath))
            {
                trimmedPath = trimmedUrl;
            }

            trimmedUrl = string.Empty;
        }

        return new Slot(trimmedUrl, trimmedPath, name, contentType);
    }

    public static Slot FirstWithEvidence(params Slot[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (candidate.HasEvidence)
            {
                return candidate;
            }
        }

        return default;
    }

    public static Slot Resolve(Slot dedicated, Slot f2TestWeight, Slot f2Corner) =>
        FirstWithEvidence(dedicated, f2TestWeight, f2Corner);

    public static Slot ResolvePlate(params Slot[] candidates) => FirstWithEvidence(candidates);

    /// <summary>
    /// preparedPaths: 0 stamp, 1 F2 test weight, 2 F2 corner, 3 dedicated weights, 4 seal.
    /// </summary>
    public static string PickPreparedWeightsPath(IReadOnlyList<string> preparedPaths)
    {
        foreach (var index in new[] { 3, 1, 2 })
        {
            if (index >= preparedPaths.Count)
            {
                continue;
            }

            var path = preparedPaths[index];
            if (!string.IsNullOrWhiteSpace(path))
            {
                return path.Trim();
            }
        }

        return string.Empty;
    }
}
