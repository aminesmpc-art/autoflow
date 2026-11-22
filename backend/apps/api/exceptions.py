"""Custom DRF exception handler for consistent API responses."""
from rest_framework.views import exception_handler


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        data = {"error": True, "status_code": response.status_code}
        if isinstance(response.data, dict):
            data["detail"] = response.data.get("detail", response.data)
            # A machine-readable reason, e.g. "account_suspended".
            if isinstance(response.data.get("code"), str):
                data["code"] = response.data["code"]
        elif isinstance(response.data, list):
            data["detail"] = response.data
        else:
            data["detail"] = str(response.data)
        response.data = data
    return response
