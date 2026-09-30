using System.Globalization;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class InstrumentDetailsService
{
    private const string DefaultLaboratorySealIdentification = "IND/GATC/KL/26/04/C26";

    private readonly FirestoreDocumentClient _documents;

    public InstrumentDetailsService(FirebaseSettings settings)
    {
        _documents = new FirestoreDocumentClient(settings);
    }

    public async Task<InstrumentDetails> ResolveForJobAsync(
        SiteCalibrationRecord job,
        string rcUserId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var calibrationFields = await _documents.GetFieldsAsync(
            "siteCalibrations", job.Id, idToken, cancellationToken);

        var rcFields = await _documents.GetFieldsAsync("users", rcUserId, idToken, cancellationToken);
        var sealIdentificationNumber = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "sealIdentificationNumber"),
            job.SealIdentificationNumber,
            FirestoreFieldReader.ReadString(rcFields, "laboratorySealIdentification"),
            DefaultLaboratorySealIdentification);

        var productId = FirestoreFieldReader.ReadString(calibrationFields, "productId");
        Dictionary<string, System.Text.Json.JsonElement>? productFields = null;

        if (!string.IsNullOrWhiteSpace(productId))
        {
            productFields = await _documents.GetFieldsAsync(
                "products", productId, idToken, cancellationToken);
        }

        var manufacturer = FirstNonEmpty(
            productFields is not null
                ? FirestoreFieldReader.ReadString(productFields, "manufacturerBrandSeries")
                : string.Empty);

        var modelApprovalNo = productFields is not null
            ? FirestoreFieldReader.ReadString(productFields, "modelApprovalNo")
            : string.Empty;

        var metrology = ProductSpecificationResolver.Resolve(calibrationFields, productFields);
        var maxCapacity = metrology.MaximumCapacity;
        var minCapacity = metrology.MinimumCapacity;
        var verificationScaleInterval = metrology.VerificationScaleInterval;
        var actualScaleInterval = metrology.ActualScaleInterval;
        var noOfVerificationIntervals = metrology.NoOfVerificationIntervals;
        var maximumPermissibleError = metrology.MaximumPermissibleError;

        var unitOfMeasurement = FirstNonEmpty(
            metrology.UnitOfMeasurement,
            productFields is not null
                ? FirestoreFieldReader.ReadString(productFields, "unitOfMeasurement")
                : string.Empty,
            FirestoreFieldReader.ReadString(calibrationFields, "unitOfMeasurement"),
            "kg");

        var verificationLocation = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "verificationLocation"),
            "in_situ");

        var serialNumber = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "serialNumber"),
            job.SerialNumber);

        var stamping = VerificationWeightPhotoResolver.ResolvePlate(
            ReadLocatedPhoto(calibrationFields, "stampingImageUrl", "stampingImagePath",
                "stampingImageName", "Stamping plate image"),
            ReadLocatedPhoto(calibrationFields, "serialPlateImageUrl", "serialPlateImagePath",
                "serialPlateImageName", "Serial plate image"),
            ReadLocatedPhoto(calibrationFields, "serialNumberPlateImageUrl", "serialNumberPlateImagePath",
                "serialNumberPlateImageName", "Serial number plate image"),
            ReadLocatedPhoto(calibrationFields, "plateImageUrl", "plateImagePath",
                "plateImageName", "Plate image"),
            ReadLocatedPhoto(calibrationFields, "stampImageUrl", "stampImagePath",
                "stampImageName", "Stamp image"));
        var stampingImageUrl = stamping.Url;
        var stampingImagePath = stamping.Path;
        var stampingImageName = FirstNonEmpty(stamping.Name, "Stamping plate image");
        var stampingImageContentType = FirstNonEmpty(stamping.ContentType, "image/jpeg");

        var scale = ReadLocatedPhoto(calibrationFields, "scaleImageUrl", "scaleImagePath",
            "scaleImageName", "Scale image");
        var scaleImageUrl = scale.Url;
        var scaleImagePath = scale.Path;
        var scaleImageName = FirstNonEmpty(scale.Name, "Scale image");
        var scaleImageContentType = FirstNonEmpty(scale.ContentType, "image/jpeg");

        var instrumentRear = ReadLocatedPhoto(
            calibrationFields, "instrumentRearImageUrl", "instrumentRearImagePath",
            "instrumentRearImageName", "Instrument rear image");
        var instrumentRearImageUrl = instrumentRear.Url;
        var instrumentRearImagePath = instrumentRear.Path;
        var instrumentRearImageName = FirstNonEmpty(instrumentRear.Name, "Instrument rear image");
        var instrumentRearImageContentType = FirstNonEmpty(instrumentRear.ContentType, "image/jpeg");

        var resolvedWeight = VerificationWeightPhotoResolver.Resolve(
            VerificationWeightPhotoResolver.FirstWithEvidence(
                ReadLocatedPhoto(calibrationFields, "standardWeightImageUrl", "standardWeightImagePath",
                    "standardWeightImageName", "Standard weight image"),
                ReadLocatedPhoto(calibrationFields, "standardWeightPhoto", "standardWeightPhotoPath",
                    "standardWeightPhotoName", "Standard weight image"),
                ReadLocatedPhoto(calibrationFields, "standardWeightPhotoUrl", "standardWeightPhotoPath",
                    "standardWeightPhotoName", "Standard weight image"),
                ReadLocatedPhoto(calibrationFields, "weightImageUrl", "weightImagePath",
                    "weightImageName", "Weight image"),
                ReadLocatedPhoto(calibrationFields, "weightsImageUrl", "weightsImagePath",
                    "weightsImageName", "Weights image"),
                ReadLocatedPhoto(calibrationFields, "weightPhotoUrl", "weightPhotoPath",
                    "weightPhotoName", "Weight photo")),
            scale,
            instrumentRear);
        var standardWeightImageUrl = resolvedWeight.Url;
        var standardWeightImagePath = resolvedWeight.Path;
        var standardWeightImageName = FirstNonEmpty(resolvedWeight.Name, "Standard weight image");
        var standardWeightImageContentType = FirstNonEmpty(
            resolvedWeight.ContentType, "image/jpeg");

        var verificationSeal = ReadLocatedPhoto(
            calibrationFields, "verificationSealImageUrl", "verificationSealImagePath",
            "verificationSealImageName", "Verification seal image");
        var verificationSealImageUrl = verificationSeal.Url;
        var verificationSealImagePath = verificationSeal.Path;
        var verificationSealImageName = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "verificationSealImageName"),
            "Verification seal image");
        var verificationSealImageContentType = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "verificationSealImageContentType"),
            "image/jpeg");

        var supplyVoltage = FirstNonEmpty(
            productFields is not null
                ? FirestoreFieldReader.ReadString(productFields, "supplyVoltage")
                : string.Empty,
            "230 V AC");

        var ambientTemperature = StripUnitSuffix(
            FirestoreFieldReader.ReadString(calibrationFields, "ambientTemperature"));
        var relativeHumidity = StripUnitSuffix(
            FirestoreFieldReader.ReadString(calibrationFields, "relativeHumidity"));

        if (string.IsNullOrWhiteSpace(manufacturer))
        {
            throw new InvalidOperationException("Product manufacturer is missing.");
        }

        if (maxCapacity is null or <= 0
            || minCapacity is null or <= 0
            || verificationScaleInterval is null or <= 0)
        {
            throw new InvalidOperationException(
                "Product capacity fields are missing (maximum, minimum, verification scale interval).");
        }

        if (actualScaleInterval is null or <= 0
            || noOfVerificationIntervals is null or <= 0
            || maximumPermissibleError is null)
        {
            throw new InvalidOperationException(
                "Product metrological fields are missing (d, n, or MPE).");
        }

        if (string.IsNullOrWhiteSpace(ambientTemperature) || string.IsNullOrWhiteSpace(relativeHumidity))
        {
            throw new InvalidOperationException(
                "Ambient temperature and relative humidity are required on the verification record.");
        }

        if (string.IsNullOrWhiteSpace(sealIdentificationNumber))
        {
            throw new InvalidOperationException(
                "Seal identification number is missing on the verification or RC profile.");
        }

        if (string.IsNullOrWhiteSpace(modelApprovalNo))
        {
            throw new InvalidOperationException(
                "Product model approval number is missing.");
        }

        var applicationNumber = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "applicationNumber"));
        if (string.IsNullOrWhiteSpace(applicationNumber))
        {
            throw new InvalidOperationException(
                "Application number is missing on the verification record.");
        }

        var verificationType = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "verificationType"),
            job.VerificationType);
        var verificationSubject = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "verificationSubject"),
            "customer");

        var fees = RcFeesResolver.Resolve(rcFields);
        var charges = DocaVerificationCharges.Resolve(
            calibrationFields,
            productFields,
            fees,
            verificationType,
            verificationLocation,
            verificationSubject,
            metrology);
        var isOv = string.Equals(verificationType, "OV", StringComparison.OrdinalIgnoreCase);
        var isRv = string.Equals(verificationType, "RV", StringComparison.OrdinalIgnoreCase);
        var zohoInvoiceNumber = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "zohoInvoiceNumber"),
            FirestoreFieldReader.ReadString(calibrationFields, "zohoInvoiceId"));
        var moneyReceiptNumber = ResolveMoneyReceiptNumber(
            isOv,
            isRv,
            applicationNumber,
            zohoInvoiceNumber);

        var submittedAt = FirestoreFieldReader.ReadString(calibrationFields, "submittedAt");
        var moneyReceiptDated = DocaVerificationCharges.FormatMoneyReceiptDate(
            string.IsNullOrWhiteSpace(submittedAt) ? job.SubmittedAt : submittedAt);

        var manufacturingYear = FirestoreFieldReader.ReadDouble(calibrationFields, "manufacturingYear");
        var yearOfManufacture = ResolveYearOfManufacture(verificationType, manufacturingYear);

        if (verificationLocation is not ("in_situ" or "in_premises"))
        {
            throw new InvalidOperationException(
                $"Verification location must be in_situ or in_premises (got \"{verificationLocation}\").");
        }

        if (string.IsNullOrWhiteSpace(serialNumber))
        {
            throw new InvalidOperationException("Device serial number is missing on the verification record.");
        }

        if (!stamping.HasEvidence)
        {
            throw new InvalidOperationException(
                "Serial number plate photo is missing on the verification record.");
        }

        var scaleImageUsesStampingFallback = !scale.HasEvidence;
        if (scaleImageUsesStampingFallback)
        {
            scaleImageUrl = stampingImageUrl;
            scaleImagePath = stampingImagePath;
            scaleImageName = stampingImageName;
            scaleImageContentType = stampingImageContentType;
        }

        return new InstrumentDetails
        {
            TypeOfInstrument = "Electronic",
            Manufacturer = manufacturer,
            YearOfManufacture = yearOfManufacture,
            ApplicationNumber = applicationNumber,
            MoneyReceiptNumber = moneyReceiptNumber,
            MoneyReceiptDated = isOv ? string.Empty : moneyReceiptDated,
            VerificationFeeTotal = isOv ? string.Empty : charges.VerificationFeeTotalText,
            TotalDeposited = isOv ? string.Empty : charges.TotalDepositedText,
            Remarks = ResolveRemarks(
                verificationType,
                FirestoreFieldReader.ReadString(rcFields, "rcCode")),
            AccuracyClass = "III",
            MaximumCapacity = DocaMetrologicalFormatter.FormatMaximumCapacity(maxCapacity.Value),
            MinimumCapacity = DocaMetrologicalFormatter.FormatGrams(minCapacity.Value),
            VerificationScaleInterval = DocaMetrologicalFormatter.FormatGrams(verificationScaleInterval.Value),
            ActualScaleInterval = DocaMetrologicalFormatter.FormatGrams(actualScaleInterval.Value),
            NoOfVerificationIntervals = FormatIntervalCount(noOfVerificationIntervals.Value),
            MaximumPermissibleError = DocaMetrologicalFormatter.FormatGrams(maximumPermissibleError.Value),
            SupplyVoltage = supplyVoltage,
            AmbientTemperature = ambientTemperature,
            RelativeHumidity = relativeHumidity,
            SealIdentificationNumber = sealIdentificationNumber,
            ModelApprovalNo = modelApprovalNo,
            VerificationLocation = verificationLocation,
            UnitOfMeasurement = unitOfMeasurement,
            SerialNumber = serialNumber,
            StampingImageUrl = stampingImageUrl,
            StampingImagePath = stampingImagePath,
            StampingImageName = stampingImageName,
            StampingImageContentType = stampingImageContentType,
            ScaleImageUrl = scaleImageUrl,
            ScaleImagePath = scaleImagePath,
            ScaleImageName = scaleImageName,
            ScaleImageContentType = scaleImageContentType,
            ScaleImageUsesStampingFallback = scaleImageUsesStampingFallback,
            InstrumentRearImageUrl = instrumentRearImageUrl,
            InstrumentRearImagePath = instrumentRearImagePath,
            InstrumentRearImageName = instrumentRearImageName,
            InstrumentRearImageContentType = instrumentRearImageContentType,
            StandardWeightImageUrl = standardWeightImageUrl,
            StandardWeightImagePath = standardWeightImagePath,
            StandardWeightImageName = standardWeightImageName,
            StandardWeightImageContentType = standardWeightImageContentType,
            VerificationSealImageUrl = verificationSealImageUrl,
            VerificationSealImagePath = verificationSealImagePath,
            VerificationSealImageName = verificationSealImageName,
            VerificationSealImageContentType = verificationSealImageContentType,
        };
    }

    private static string ResolveMoneyReceiptNumber(
        bool isOv,
        bool isRv,
        string applicationNumber,
        string zohoInvoiceNumber)
    {
        if (isOv)
        {
            return string.Empty;
        }

        if (isRv)
        {
            if (string.IsNullOrWhiteSpace(zohoInvoiceNumber))
            {
                throw new InvalidOperationException(
                    "Zoho invoice number is missing on the RV verification record. " +
                    "DOCA money receipt requires the Zoho invoice number (e.g. YES/26-27/0764).");
            }

            return zohoInvoiceNumber;
        }

        return applicationNumber;
    }

    private static string ResolveRemarks(string verificationType, string? rcCode)
    {
        var code = NormalizeRcCode(rcCode);
        var isRv = string.Equals(verificationType, "RV", StringComparison.OrdinalIgnoreCase);
        if (code.Length == 3)
        {
            return isRv
                ? $"Re verification by {code}"
                : $"Original verification by {code}";
        }

        return isRv ? "Re verification" : "Original verification";
    }

    private static string NormalizeRcCode(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return string.Empty;
        }

        return new string(input
            .Where(char.IsLetterOrDigit)
            .Take(3)
            .Select(char.ToUpperInvariant)
            .ToArray());
    }

    private static string ResolveYearOfManufacture(string verificationType, double? manufacturingYear)
    {
        if (string.Equals(verificationType, "RV", StringComparison.OrdinalIgnoreCase)
            && manufacturingYear is > 0)
        {
            return ((int)Math.Round(manufacturingYear.Value, MidpointRounding.AwayFromZero))
                .ToString(CultureInfo.InvariantCulture);
        }

        return DateTime.Now.Year.ToString(CultureInfo.InvariantCulture);
    }

    private static string FormatIntervalCount(double value)
    {
        if (Math.Abs(value % 1) < 0.000001)
        {
            return ((long)value).ToString(CultureInfo.InvariantCulture);
        }

        return value.ToString("0.##", CultureInfo.InvariantCulture);
    }

    private static string StripUnitSuffix(string value)
    {
        var trimmed = value.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return string.Empty;
        }

        return trimmed
            .Replace("°C", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("°c", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("%", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Trim();
    }

    private static VerificationWeightPhotoResolver.Slot ReadLocatedPhoto(
        IReadOnlyDictionary<string, System.Text.Json.JsonElement> fields,
        string urlKey,
        string pathKey,
        string nameKey,
        string defaultName)
    {
        return VerificationWeightPhotoResolver.Normalize(
            FirestoreFieldReader.ReadString(fields, urlKey),
            FirestoreFieldReader.ReadString(fields, pathKey),
            FirstNonEmpty(FirestoreFieldReader.ReadString(fields, nameKey), defaultName),
            FirstNonEmpty(FirestoreFieldReader.ReadString(fields, urlKey.Replace("Url", "ContentType", StringComparison.Ordinal)), "image/jpeg"));
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }
}
