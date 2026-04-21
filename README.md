Here's a comprehensive API documentation for your Sign Up endpoint, formatted for README.com:

---

# User Registration API

Create a new user account on Campus Hive platform. Users can register as either buyers or sellers with their profile information and verification details.

## Endpoint

```http
POST /api/auth/register
```

## Authentication

No authentication required for this endpoint.

## Request Headers

| Header | Value | Required | Description |
|--------|-------|----------|-------------|
| Content-Type | application/json | Yes | Must be set to `application/json` |
| Accept | application/json | Yes | Must be set to `application/json` |

## Request Body

The request body must be a JSON object containing the following fields:

### Required Fields

| Field | Type | Description | Validation Rules |
|-------|------|-------------|------------------|
| email | string | User's email address | • Must be a valid email format<br>• Must be unique<br>• Automatically converted to lowercase |
| profile.displayName | string | Public display name | • Minimum 3 characters<br>• Maximum 50 characters<br>• Must be unique |
| role | string | User role | Must be one of: `"buyer"`, `"seller"`, `"admin"` |
| agreedToTerms | boolean | Terms agreement | Must be `true` to register |

### Optional Fields

| Field | Type | Description | Validation Rules |
|-------|------|-------------|------------------|
| password | string | Account password | • Required for email-based registration<br>• Minimum 8 characters<br>• Will be hashed using Argon2id |
| provider | string | Authentication provider | Values: `"email"`, `"google"`, `"facebook"`, `"apple"` |
| providerId | string | OAuth provider ID | Required if using OAuth providers |
| profile.bio | string | User biography | Maximum 500 characters<br>Default: "Hey I'm using Campus Hive!" |
| profile.avatar | string | Profile picture URL | Must be a valid URL |
| personalDetails | object | Personal information | See [Personal Details](#personal-details-object) |
| studentStatus | object | Student information | See [Student Status Object](#student-status-object) |
| businessProfile | object | Business information | Required for sellers<br>See [Business Profile Object](#business-profile-object) |
| identification | object | Verification documents | See [Identification Object](#identification-object) |

### Personal Details Object

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| fullName | string | User's full name | Maximum 100 characters |
| dateOfBirth | date | Date of birth (YYYY-MM-DD) | Cannot be in the future |
| stateOfOrigin | string | Home state/region | |
| phones | array[string] | Phone numbers | • Must be valid phone numbers<br>• Must be unique across users |

### Student Status Object

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| isStudent | boolean | Student status | Default: `false` |
| schoolName | string | School Name | |
| studentId | string | Student ID number | Must be unique if provided |
| enrollmentYear | number | Year of enrollment | Must be between 1900 and current year + 5 |

### Business Profile Object (Required for sellers)

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| name | string | Business name | Required for sellers |
| description | string | Business description | Maximum 1000 characters |
| tags | array[string] | Business categories | Maximum 10 tags |

### Identification Object

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| imageUrl | string | ID document URL | Must be a valid URL |
| verified | boolean | Verification status | Default: `false` |
| verifiedAt | date | Verification timestamp | |
| verificationMethod | string | Verification method | Values: `"manual"`, `"automated"`, `"third_party"` |

## Request Examples

### Basic Buyer Registration

```json
{
  "email": "john.doe@example.com",
  "password": "SecurePass123!",
  "profile": {
    "displayName": "JohnDoe123",
    "bio": "Campus student looking for great deals!"
  },
  "role": "buyer",
  "agreedToTerms": true
}
```

### Complete Buyer Registration

```json
{
  "email": "jane.smith@university.edu",
  "password": "MySecurePassword2024!",
  "profile": {
    "displayName": "JaneSmith",
    "bio": "Computer Science student passionate about tech",
    "avatar": "https://ui-avatars.com/api/?name=Jane+Smith"
  },
  "personalDetails": {
    "fullName": "Jane Marie Smith",
    "dateOfBirth": "2000-05-15",
    "stateOfOrigin": "California",
    "phones": ["+1234567890", "+1987654321"]
  },
  "studentStatus": {
    "isStudent": true,
    "schoolName": "Ahmadu Bello University",
    "studentId": "STU2024001",
    "enrollmentYear": 2024
  },
  "role": "buyer",
  "agreedToTerms": true
}
```

### Seller Registration

```json
{
  "email": "tech.store@business.com",
  "password": "BusinessPass456!",
  "profile": {
    "displayName": "TechGadgets",
    "bio": "Premium electronics and gadgets for campus students"
  },
  "personalDetails": {
    "fullName": "Michael Chen",
    "dateOfBirth": "1985-03-22",
    "stateOfOrigin": "Texas",
    "phones": ["+15551234567"]
  },
  "role": "seller",
  "agreedToTerms": true,
  "businessProfile": {
    "name": "TechGadgets Campus Store",
    "description": "Authorized reseller of laptops, smartphones, and accessories",
    "tags": ["electronics", "laptops", "smartphones", "accessories"]
  }
}
```

### Student Seller Registration

```json
{
  "email": "student.entrepreneur@university.edu",
  "password": "StudentBiz789!",
  "profile": {
    "displayName": "CampusBooks",
    "bio": "Selling textbooks and study materials at student-friendly prices"
  },
  "personalDetails": {
    "fullName": "Sarah Johnson",
    "dateOfBirth": "2001-08-10",
    "stateOfOrigin": "New York",
    "phones": ["+15559876543"]
  },
  "studentStatus": {
    "isStudent": true,
    "schoolName": "Ahmadu Bello University",
    "studentId": "STU2024123",
    "enrollmentYear": 2023
  },
  "role": "seller",
  "agreedToTerms": true,
  "businessProfile": {
    "name": "Campus Book Exchange",
    "description": "Buy and sell used textbooks, notes, and study guides",
    "tags": ["textbooks", "study-materials", "notes"]
  }
}
```

## Response

### Success Response (201 Created)

```json
{
  "message": "User registered successfully. Please verify your email.",
  "data": {
    "userId": "65f7a8b9c0d1e2f3a4b5c6d7",
    "email": "john.doe@example.com",
    "profile": {
      "displayName": "JohnDoe123",
      "bio": "Campus student looking for great deals!",
      "avatar": "https://ui-avatars.com/api/?name=John+Doe"
    },
    "role": "buyer",
    "emailVerified": false
  }
}
```

### Error Responses

#### 400 Bad Request - Missing Required Fields

```json
{
  "message": "Missing required fields: email, profile.displayName, role, agreedToTerms"
}
```

#### 400 Bad Request - Validation Error

```json
{
  "message": "Validation error",
  "errors": [
    "Password must be at least 8 characters",
    "Display name must be at least 3 characters"
  ]
}
```

#### 409 Conflict - Email Already Exists

```json
{
  "message": "Email already in use"
}
```

#### 409 Conflict - Display Name Already Taken

```json
{
  "message": "Display name already taken"
}
```

#### 409 Conflict - Phone Number Already in Use

```json
{
  "message": "Phone number +1234567890 already in use"
}
```

#### 400 Bad Request - Seller Without Business Name

```json
{
  "message": "Business name is required for sellers"
}
```

#### 500 Internal Server Error

```json
{
  "message": "Internal Server Error"
}
```

## Status Codes

| Status Code | Description |
|-------------|-------------|
| 201 | Created - User successfully registered |
| 400 | Bad Request - Missing or invalid fields |
| 409 | Conflict - Email, display name, or phone number already exists |
| 500 | Internal Server Error - Server-side error occurred |

## Notes

### Password Security
- Passwords are hashed using Argon2id with the following parameters:
  - Memory cost: 16 MB
  - Time cost: 2 iterations
  - Parallelism: 1 thread
- Plain text passwords are never stored in the database
- Passwords are never returned in API responses

### Email Verification
- For email-based registration, a 6-digit verification code is generated
- Verification codes expire after 24 hours
- A verification email is sent to the user's email address
- Users must verify their email before accessing certain features

### OAuth Registration
- When using OAuth providers (Google, Facebook, Apple):
  - Password field is not required
  - Email is automatically marked as verified
  - Provider information must be included

### Rate Limiting
- Maximum 5 registration attempts per IP address per hour
- Exceeding the limit will result in a 429 Too Many Requests response

### Data Retention
- User data is retained according to our privacy policy
- Deactivated accounts are marked but not immediately deleted
- Users can request account deletion through support

## Testing

Use the following test accounts to verify functionality:

### Test Credentials
- **Buyer**: john.doe@example.com / SecurePass123!
- **Seller**: tech.store@business.com / BusinessPass456!
- **Student Seller**: student.entrepreneur@university.edu / StudentBiz789!

### Postman Collection
Import the provided Postman collection to test all registration scenarios:
[Download Postman Collection](#)

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-25 | Initial API release |
\n### Student Status Field Update\n- The studentStatus.schoolName field replaces studentStatus.departmentFaculty (deprecated).\n
