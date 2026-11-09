# Campus Market API

## Base URL

```text
https://api-campushive.vercel.app/api/v1
```

For the examples below, set:

```bash
export BASE_URL="https://api-campushive.vercel.app/api/v1"
```

The server's health check is available at `GET /health`.

## Authentication endpoints

All paths below are relative to the base URL. JSON request bodies use
`Content-Type: application/json`. None of these endpoints require an access
token.

### `POST /auth/sign-up`

Creates an account and emails a verification code.

- **Authentication:** Not required
- **Content-Type:** `application/json`

#### Request body

```json
{
  "email": "user@example.com",
  "password": "your-password",
  "fullName": "Alex User"
}
```

#### Responses

**`201 Created`**

```json
{
  "message": "User created successfully",
  "verification": {
    "token": "verification-token",
    "email": "user@example.com",
    "expiry": {
      "duration": 10,
      "parameter": "minutes"
    }
  }
}
```

**`400 Bad Request`** — Invalid email, missing field, or email delivery failed.

**`409 Conflict`** — An account with this email already exists.

#### Example

```bash
curl -X POST "$BASE_URL/auth/sign-up" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"your-password","fullName":"Alex User"}'
```

### `POST /auth/sign-up/verify-email/:token`

Verifies the email code and creates a session.

- **Authentication:** Not required
- **Content-Type:** `application/json`

#### Path parameters

| Name | Type | Required | Description |
|---|---|---:|---|
| `token` | string | Yes | Verification token returned by sign-up |

#### Request body

```json
{
  "otp": "A1B2C3"
}
```

#### Responses

**`200 OK`**

```json
{
  "success": true,
  "session": {
    "session": {
      "accessToken": "access-token",
      "refreshToken": "refresh-token"
    },
    "success": true,
    "message": "Session created"
  },
  "user": {
    "id": "user-id",
    "username": "alex123_hive",
    "profileImage": null,
    "role": "USER"
  },
  "message": "Session created successfully"
}
```

**`400 Bad Request`** — Invalid or expired token/code, or session creation failed.

#### Example

```bash
curl -X POST "$BASE_URL/auth/sign-up/verify-email/verification-token" \
  -H "Content-Type: application/json" \
  -d '{"otp":"A1B2C3"}'
```

### `POST /auth/sign-in`

Signs in with an email and password and creates a session.

- **Authentication:** Not required
- **Content-Type:** `application/json`

#### Request body

```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

#### Responses

**`200 OK`** — Returns the session and user details in the format shown for email verification above.

**`400 Bad Request`** — Invalid email or missing password.

**`401 Unauthorized`** — Email or password is incorrect.

#### Example

```bash
curl -X POST "$BASE_URL/auth/sign-in" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"your-password"}'
```

### `PUT /auth/refresh/:token`

Creates new access and refresh tokens using a refresh token.

- **Authentication:** Not required; provide the refresh token in the path

#### Path parameters

| Name | Type | Required | Description |
|---|---|---:|---|
| `token` | string | Yes | Current refresh token |

#### Responses

**`200 OK`**

```json
{
  "success": true,
  "session": {
    "accessToken": "new-access-token",
    "refreshToken": "new-refresh-token"
  }
}
```

**`401 Unauthorized`** — The session is missing or expired.

#### Example

```bash
curl -X PUT "$BASE_URL/auth/refresh/refresh-token"
```

### `GET /auth/verify-email/:token/new`

Emails a replacement verification code. A new code can be requested once per minute.

- **Authentication:** Not required

#### Path parameters

| Name | Type | Required | Description |
|---|---|---:|---|
| `token` | string | Yes | Verification token |

#### Responses

**`200 OK`** — Returns the verification token, email address, and code expiry.

**`400 Bad Request`** — A code was requested too recently, or email delivery failed.

**`403 Forbidden`** — Verification token is invalid.

#### Example

```bash
curl "$BASE_URL/auth/verify-email/verification-token/new"
```

### `POST /auth/forget-password`

Emails a code to verify a password-reset request.

- **Authentication:** Not required
- **Content-Type:** `application/json`

#### Request body

```json
{
  "email": "user@example.com"
}
```

#### Responses

**`200 OK`** — Returns a verification token, email address, and code expiry.

**`400 Bad Request`** — Email is missing or email delivery failed.

**`404 Not Found`** — No account exists for this email.

#### Example

```bash
curl -X POST "$BASE_URL/auth/forget-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

### `POST /auth/forget-password/:token`

Verifies the password-reset code.

- **Authentication:** Not required
- **Content-Type:** `application/json`

#### Path parameters

| Name | Type | Required | Description |
|---|---|---:|---|
| `token` | string | Yes | Reset token returned by the request endpoint |

#### Request body

```json
{
  "otp": "A1B2C3"
}
```

#### Responses

**`200 OK`** — Confirms the code was verified.

**`400 Bad Request`** — Token or code is invalid or expired.

#### Example

```bash
curl -X POST "$BASE_URL/auth/forget-password/verification-token" \
  -H "Content-Type: application/json" \
  -d '{"otp":"A1B2C3"}'
```

### `PUT /auth/forget-password/:token/new-password`

Sets a new password after the reset code has been verified.

- **Authentication:** Not required; the verified reset token is required
- **Content-Type:** `application/json`

#### Path parameters

| Name | Type | Required | Description |
|---|---|---:|---|
| `token` | string | Yes | Verified reset token |

#### Request body

```json
{
  "newPassword": "your-new-password"
}
```

#### Responses

**`200 OK`**

```json
{
  "message": "Password updated successfully",
  "success": true
}
```

**`400 Bad Request`** — Token is invalid or password is missing.

**`403 Forbidden`** — Reset token has not been verified.

#### Example

```bash
curl -X PUT "$BASE_URL/auth/forget-password/verification-token/new-password" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"your-new-password"}'
```
